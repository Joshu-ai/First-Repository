import { EQUIPMENT, NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS } from './equipment';
import { roadMiles, transitHours } from './geo';
import { estimateRate } from './rates';
import type { DriverProfile, EquipmentCode, Load, MatchBreakdown, MatchCheck, MatchResult } from './types';

/** The load fields the matcher reads, so callers can match drafts that are not saved yet. */
export type MatchableLoad = Pick<
  Load,
  | 'status'
  | 'origin'
  | 'destination'
  | 'pickupStart'
  | 'pickupEnd'
  | 'equipmentTypes'
  | 'weightLbs'
  | 'lengthFt'
  | 'hazmat'
  | 'teamRequired'
  | 'rateUsd'
  | 'miles'
>;

export type MatchableDriver = Pick<
  DriverProfile,
  | 'driverClass'
  | 'equipmentTypes'
  | 'trailerLengthFt'
  | 'maxPayloadLbs'
  | 'hasCdl'
  | 'endorsements'
  | 'teamDriver'
  | 'currentLocation'
  | 'homeBase'
  | 'availableFrom'
  | 'maxDeadheadMiles'
  | 'minRatePerMile'
  | 'preferredStates'
  | 'avoidStates'
  | 'mpg'
  | 'fuelPricePerGallon'
> &
  /** Omitted or null with hasCdl counts as Class A, the common case, so older callers keep working. */
  Partial<Pick<DriverProfile, 'cdlClass'>>;

export interface MatchOptions {
  now?: Date;
  /** Treat deadhead over the driver's limit as a soft check (used for backhaul and shipper views). */
  ignoreDeadheadLimit?: boolean;
}

export const SCORE_WEIGHTS: Record<keyof MatchBreakdown, number> = {
  deadhead: 0.3,
  rate: 0.35,
  fit: 0.1,
  timing: 0.15,
  lane: 0.1,
};

const HOUR_MS = 3_600_000;

const CLOSED_STATUS_LABELS: Record<Exclude<Load['status'], 'open'>, string> = {
  booked: 'Load is already booked',
  in_transit: 'Load is already on the road',
  delivered: 'Load was already delivered',
  cancelled: 'Load was cancelled',
};

/** A load only "heads toward home" when it closes at least this share of the distance home. */
const TOWARD_HOME_MIN_GAIN = 0.25;

/** Pay at or under this share of the lane market scores 0 on rate. */
const RATE_FLOOR_RATIO = 0.7;
/** Pay exactly at the lane market scores this on rate. */
const AT_MARKET_RATE_SCORE = 60;
/** Steepness of the rate curve, set so pay at market lands on AT_MARKET_RATE_SCORE. */
const RATE_CURVE = -Math.log(1 - AT_MARKET_RATE_SCORE / 100) / (1 - RATE_FLOOR_RATIO);
/** "Pays above market" from this share of the lane market. */
const ABOVE_MARKET_RATIO = 1.1;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtLbs = (n: number) => n.toLocaleString('en-US');
const fmtRate = (n: number) => `$${n.toFixed(2)}/mi`;

/**
 * Rate component (0..100) for pay at `marketRatio` times the lane market: 0 at 70% of market, 60 at
 * market, then still rising with diminishing returns (78 at 120%, 91 at 150%, 98 at 2x), so pay keeps
 * counting well past market instead of flattening out.
 */
export function rateScoreFor(marketRatio: number): number {
  return Math.round(100 * (1 - Math.exp(-RATE_CURVE * Math.max(0, marketRatio - RATE_FLOOR_RATIO))));
}

/**
 * What the market pays for this driver's whole run, deadhead included: the rate estimate for the
 * loaded plus deadhead miles, on the cheapest equipment the driver would use (as estimateRate
 * picks it). Judging the trip, not a flat $/mi, keeps short hops with their minimum charge and
 * short-haul premium on the same footing as long runs.
 */
export function marketRateFor(load: MatchableLoad, equipment: EquipmentCode[], totalMiles: number): number {
  return estimateRate(totalMiles, equipment, load).suggestedUsd;
}

export function matchLoad(load: MatchableLoad, driver: MatchableDriver, opts: MatchOptions = {}): MatchResult {
  const now = opts.now ?? new Date();
  const checks: MatchCheck[] = [];
  const highlights: string[] = [];
  const add = (key: MatchCheck['key'], ok: boolean, hard: boolean, label: string) =>
    checks.push({ key, ok, hard, label });

  // Availability of the load itself.
  const pickupEnd = new Date(load.pickupEnd).getTime();
  const pickupStart = new Date(load.pickupStart).getTime();
  if (load.status !== 'open') {
    add('status', false, true, CLOSED_STATUS_LABELS[load.status]);
  } else if (pickupEnd < now.getTime()) {
    add('status', false, true, 'Pickup window has passed');
  } else {
    add('status', true, true, 'Open for booking');
  }

  // Equipment.
  const matchedEquipment = load.equipmentTypes.filter((e) => driver.equipmentTypes.includes(e));
  if (matchedEquipment.length > 0) {
    add('equipment', true, true, `Your ${EQUIPMENT[matchedEquipment[0]].shortLabel.toLowerCase()} works`);
  } else {
    const wanted = load.equipmentTypes.map((e) => EQUIPMENT[e].shortLabel).join(' or ');
    add('equipment', false, true, `Needs ${wanted || 'unspecified equipment'}`);
  }

  // Capacity.
  if (load.weightLbs <= driver.maxPayloadLbs) {
    add('weight', true, true, `${fmtLbs(load.weightLbs)} lbs of your ${fmtLbs(driver.maxPayloadLbs)} lbs capacity`);
  } else {
    add('weight', false, true, `Too heavy: ${fmtLbs(load.weightLbs)} lbs over your ${fmtLbs(driver.maxPayloadLbs)} lbs limit`);
  }
  if (load.lengthFt <= driver.trailerLengthFt) {
    add('length', true, true, `${load.lengthFt} ft fits your ${driver.trailerLengthFt} ft deck`);
  } else {
    add('length', false, true, `Too long: ${load.lengthFt} ft on a ${driver.trailerLengthFt} ft deck`);
  }

  // Licensing. Semi equipment always needs a Class A CDL; a non-CDL hotshot is capped by weight.
  // Every rig here is a combination (truck + trailer), and a Class B CDL does not cover a
  // combination over 26,000 lbs, so a Class B holder is held to the same limits as no CDL.
  const usableEquipment = matchedEquipment.length > 0 ? matchedEquipment : load.equipmentTypes;
  const onlySemi = usableEquipment.length > 0 && usableEquipment.every((e) => EQUIPMENT[e].driverClass === 'semi');
  const classB = driver.hasCdl && driver.cdlClass === 'B';
  if (!driver.hasCdl || classB) {
    const yours = classB ? ' (yours is Class B)' : '';
    if (onlySemi) {
      add('cdl', false, true, `Requires a Class A CDL${yours}`);
    } else if (load.weightLbs > NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS) {
      const needs = classB ? `a Class A CDL${yours}` : 'a CDL (26,001+ lbs combination)';
      add('cdl', false, true, `Over ${fmtLbs(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)} lbs: needs ${needs}`);
    }
  }
  if (load.hazmat) {
    const ok = driver.hasCdl && driver.endorsements.includes('hazmat');
    add('hazmat', ok, true, ok ? 'Hazmat endorsement on file' : 'Hazmat: needs a CDL with H endorsement');
  }
  if (matchedEquipment.length > 0 && matchedEquipment.every((e) => EQUIPMENT[e].requiresEndorsement === 'tanker')) {
    const ok = driver.hasCdl && driver.endorsements.includes('tanker');
    add('tanker', ok, true, ok ? 'Tanker endorsement on file' : 'Tanker: needs N endorsement');
  }
  if (load.teamRequired) {
    add('team', driver.teamDriver, true, driver.teamDriver ? 'Team load and you run team' : 'Team drivers required');
  }
  if (driver.avoidStates.includes(load.destination.state)) {
    add('avoid_state', false, true, `Delivers to ${load.destination.state}, which is on your avoid list`);
  }

  // Deadhead.
  const deadheadMiles = driver.currentLocation ? roadMiles(driver.currentLocation, load.origin) : null;
  const maxDeadhead = Math.max(1, driver.maxDeadheadMiles);
  if (deadheadMiles === null) {
    add('deadhead', true, false, 'Set your location to see deadhead');
  } else if (deadheadMiles <= driver.maxDeadheadMiles) {
    add('deadhead', true, true, `${deadheadMiles} mi deadhead to pickup`);
  } else {
    add(
      'deadhead',
      false,
      !opts.ignoreDeadheadLimit,
      `${deadheadMiles} mi deadhead, over your ${driver.maxDeadheadMiles} mi limit`,
    );
  }

  // Timing: can the driver reach pickup before the window closes? A long deadhead includes the
  // 10-hour break hours of service require after 11 hours of driving.
  const readyAt = Math.max(now.getTime(), driver.availableFrom ? new Date(driver.availableFrom).getTime() : 0);
  const arriveAt = readyAt + transitHours(deadheadMiles ?? 0) * HOUR_MS;
  let timingScore: number;
  if (arriveAt > pickupEnd) {
    const late = Math.round((arriveAt - pickupEnd) / HOUR_MS);
    add('timing', false, true, `Can't reach pickup in time (about ${Math.max(1, late)}h late)`);
    timingScore = 0;
  } else {
    // Score the wait from when the driver is ready, not from arrival: hours spent deadheading are
    // not productive either, and counting them would let a farther driver outscore a closer one.
    const idleHours = Math.max(0, (pickupStart - readyAt) / HOUR_MS);
    timingScore = idleHours <= 12 ? 100 : Math.round(100 - 80 * clamp01((idleHours - 12) / 84));
    const waitHours = Math.max(0, (pickupStart - arriveAt) / HOUR_MS);
    const label = arriveAt >= pickupStart ? 'You can make the pickup window' : `Pickup opens ${formatWait(waitHours)} after you arrive`;
    add('timing', true, true, label);
  }

  // Money.
  const loadedMiles = Math.max(1, load.miles);
  const totalMiles = loadedMiles + (deadheadMiles ?? 0);
  const effectiveRatePerMile = round2(load.rateUsd / totalMiles);
  const fuelCostUsd = Math.round((totalMiles / Math.max(1, driver.mpg)) * driver.fuelPricePerGallon);
  const estimatedProfitUsd = Math.round(load.rateUsd - fuelCostUsd);
  const rateOk = effectiveRatePerMile >= driver.minRatePerMile;
  add(
    'rate',
    rateOk,
    false,
    rateOk
      ? `${fmtRate(effectiveRatePerMile)} all-in with deadhead`
      : `${fmtRate(effectiveRatePerMile)} with deadhead, under your ${fmtRate(driver.minRatePerMile)} minimum`,
  );

  // Scores.
  const marketRatio = load.rateUsd / marketRateFor(load, usableEquipment, totalMiles);
  const deadheadScore =
    deadheadMiles === null ? 60 : Math.round(100 * clamp01(1 - deadheadMiles / maxDeadhead));
  let rateScore = rateScoreFor(marketRatio);
  if (!rateOk) rateScore = Math.min(rateScore, 30);
  const utilization = Math.max(load.weightLbs / Math.max(1, driver.maxPayloadLbs), load.lengthFt / Math.max(1, driver.trailerLengthFt));
  const fitScore = Math.round(100 * (0.6 + 0.4 * clamp01(utilization / 0.8)));
  const laneScore = scoreLane(load, driver);

  const breakdown: MatchBreakdown = {
    deadhead: deadheadScore,
    rate: rateScore,
    fit: fitScore,
    timing: timingScore,
    lane: laneScore.score,
  };
  const eligible = checks.every((c) => c.ok || !c.hard);
  const weighted = (Object.keys(SCORE_WEIGHTS) as (keyof MatchBreakdown)[]).reduce(
    (sum, k) => sum + SCORE_WEIGHTS[k] * breakdown[k],
    0,
  );
  const score = eligible ? Math.max(1, Math.min(100, Math.round(weighted))) : 0;

  if (eligible) {
    if (deadheadMiles !== null && deadheadMiles <= 25) highlights.push('Pickup is close by');
    if (marketRatio >= ABOVE_MARKET_RATIO) highlights.push('Pays above market');
    if (laneScore.towardHome) highlights.push('Heads toward home');
    if (laneScore.preferred) highlights.push(`Delivers to ${load.destination.state}, a preferred state`);
    if (driver.driverClass === 'hotshot' && matchedEquipment.some((e) => EQUIPMENT[e].driverClass === 'hotshot')) {
      highlights.push('Hotshot-ready freight');
    }
  }

  return {
    eligible,
    score,
    deadheadMiles,
    loadedMiles,
    totalMiles,
    effectiveRatePerMile,
    fuelCostUsd,
    estimatedProfitUsd,
    matchedEquipment,
    checks,
    highlights,
    breakdown,
  };
}

function formatWait(hours: number): string {
  if (hours < 1) return 'shortly';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

function scoreLane(load: MatchableLoad, driver: MatchableDriver): { score: number; towardHome: boolean; preferred: boolean } {
  const preferred = driver.preferredStates.includes(load.destination.state);
  let towardHome = false;
  let score = preferred ? 100 : 50;
  if (driver.homeBase) {
    const fromHomeAtPickup = roadMiles(load.origin, driver.homeBase);
    const fromHomeAtDrop = roadMiles(load.destination, driver.homeBase);
    const improvement = fromHomeAtPickup > 0 ? clamp01((fromHomeAtPickup - fromHomeAtDrop) / fromHomeAtPickup) : 0;
    if (fromHomeAtPickup > 50 && improvement >= TOWARD_HOME_MIN_GAIN) {
      towardHome = true;
      score = Math.max(score, Math.round(60 + 40 * improvement));
    } else if (!preferred) {
      score = 40;
    }
  }
  return { score, towardHome, preferred };
}

/** Sort comparator for the "best match" ordering: eligible first, then score, then profit. */
export function compareMatches(a: MatchResult | null, b: MatchResult | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  return b.score - a.score || b.estimatedProfitUsd - a.estimatedProfitUsd;
}
