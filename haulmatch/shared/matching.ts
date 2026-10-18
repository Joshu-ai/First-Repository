import { EQUIPMENT, NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS } from './equipment';
import { driveHours, roadMiles } from './geo';
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
>;

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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtLbs = (n: number) => n.toLocaleString('en-US');
const fmtRate = (n: number) => `$${n.toFixed(2)}/mi`;

/** Market benchmark for a load, judged by the equipment this driver would use to haul it. */
export function benchmarkFor(equipment: EquipmentCode[]): number {
  if (equipment.length === 0) return 0;
  return Math.max(...equipment.map((e) => EQUIPMENT[e].benchmarkRatePerMile));
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
    add('status', false, true, load.status === 'cancelled' ? 'Load was cancelled' : 'Load is already booked');
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

  // Licensing. Semi equipment always needs a CDL; a non-CDL hotshot is capped by weight.
  const usableEquipment = matchedEquipment.length > 0 ? matchedEquipment : load.equipmentTypes;
  const onlySemi = usableEquipment.length > 0 && usableEquipment.every((e) => EQUIPMENT[e].driverClass === 'semi');
  if (!driver.hasCdl) {
    if (onlySemi) {
      add('cdl', false, true, 'Requires a Class A CDL');
    } else if (load.weightLbs > NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS) {
      add('cdl', false, true, `Over ${fmtLbs(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)} lbs: needs a CDL (26,001+ lbs combination)`);
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

  // Timing: can the driver reach pickup before the window closes?
  const readyAt = Math.max(now.getTime(), driver.availableFrom ? new Date(driver.availableFrom).getTime() : 0);
  const arriveAt = readyAt + driveHours(deadheadMiles ?? 0) * HOUR_MS;
  let timingScore: number;
  if (arriveAt > pickupEnd) {
    const late = Math.round((arriveAt - pickupEnd) / HOUR_MS);
    add('timing', false, true, `Can't reach pickup in time (about ${Math.max(1, late)}h late)`);
    timingScore = 0;
  } else {
    const waitHours = Math.max(0, (pickupStart - arriveAt) / HOUR_MS);
    timingScore = waitHours <= 12 ? 100 : Math.round(100 - 80 * clamp01((waitHours - 12) / 84));
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
  const benchmark = benchmarkFor(usableEquipment) || 2;
  const deadheadScore =
    deadheadMiles === null ? 60 : Math.round(100 * clamp01(1 - deadheadMiles / maxDeadhead));
  let rateScore = Math.round(100 * clamp01((effectiveRatePerMile / benchmark - 0.7) / 0.5));
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
    if (effectiveRatePerMile >= benchmark * 1.1) highlights.push('Pays above market');
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
    if (fromHomeAtPickup > 50 && fromHomeAtDrop < fromHomeAtPickup) {
      towardHome = true;
      const improvement = clamp01((fromHomeAtPickup - fromHomeAtDrop) / fromHomeAtPickup);
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
