import { describe, expect, it } from 'vitest';
import { CITIES, placeForCityId } from '../../shared/cities';
import { EQUIPMENT } from '../../shared/equipment';
import { driveHours, roadMiles, transitHours } from '../../shared/geo';
import {
  compareMatches,
  marketRateFor,
  matchLoad,
  rateScoreFor,
  SCORE_WEIGHTS,
  type MatchableDriver,
  type MatchableLoad,
  type MatchOptions,
} from '../../shared/matching';
import { estimateRate } from '../../shared/rates';
import type { MatchBreakdown, MatchCheck, MatchCheckKey, MatchResult } from '../../shared/types';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-10-18T12:00:00.000Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS).toISOString();
const place = (id: string) => {
  const p = placeForCityId(id);
  if (!p) throw new Error(`unknown city ${id}`);
  return p;
};

/** Houston, TX -> Odessa, TX, hotshot or semi flatbed, pickup window opens in 6h and closes in 30h. */
function makeLoad(overrides: Partial<MatchableLoad> = {}): MatchableLoad {
  const base: MatchableLoad = {
    status: 'open',
    origin: place('houston-tx'),
    destination: place('odessa-tx'),
    pickupStart: at(6),
    pickupEnd: at(30),
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 8_000,
    lengthFt: 30,
    hazmat: false,
    teamRequired: false,
    rateUsd: 1_400,
    miles: 0,
    ...overrides,
  };
  return { ...base, miles: overrides.miles ?? roadMiles(base.origin, base.destination) };
}

/** Non-CDL hotshot with a 40 ft gooseneck parked at the default pickup (Houston). */
function hotshot(overrides: Partial<MatchableDriver> = {}): MatchableDriver {
  return {
    driverClass: 'hotshot',
    equipmentTypes: ['HS_GOOSENECK'],
    trailerLengthFt: 40,
    maxPayloadLbs: 10_000,
    hasCdl: false,
    endorsements: [],
    teamDriver: false,
    currentLocation: place('houston-tx'),
    homeBase: null,
    availableFrom: null,
    maxDeadheadMiles: 150,
    minRatePerMile: 1.5,
    preferredStates: [],
    avoidStates: [],
    mpg: 11,
    fuelPricePerGallon: 3.75,
    ...overrides,
  };
}

/** CDL-A flatbed semi parked in Houston. */
function semi(overrides: Partial<MatchableDriver> = {}): MatchableDriver {
  return hotshot({
    driverClass: 'semi',
    equipmentTypes: ['FLATBED'],
    trailerLengthFt: 48,
    maxPayloadLbs: 48_000,
    hasCdl: true,
    maxDeadheadMiles: 200,
    minRatePerMile: 1.9,
    mpg: 6.5,
    ...overrides,
  });
}

const match = (load: MatchableLoad, driver: MatchableDriver, opts: MatchOptions = {}) =>
  matchLoad(load, driver, { now: NOW, ...opts });
const check = (m: MatchResult, key: MatchCheckKey): MatchCheck | undefined => m.checks.find((c) => c.key === key);
const failed = (m: MatchResult) => m.checks.filter((c) => !c.ok).map((c) => c.key);
const weightedScore = (b: MatchBreakdown) =>
  (Object.keys(SCORE_WEIGHTS) as (keyof MatchBreakdown)[]).reduce((sum, k) => sum + SCORE_WEIGHTS[k] * b[k], 0);

describe('matchLoad: a load that fits', () => {
  const m = match(makeLoad(), hotshot());

  it('passes every hard check and runs them in a stable order', () => {
    expect(m.eligible).toBe(true);
    expect(m.checks.map((c) => c.key)).toEqual(['status', 'equipment', 'weight', 'length', 'deadhead', 'timing', 'rate']);
    expect(m.checks.every((c) => c.ok)).toBe(true);
    expect(m.checks.filter((c) => !c.hard).map((c) => c.key)).toEqual(['rate']);
  });

  it('labels each check in plain driver language', () => {
    expect(check(m, 'status')!.label).toBe('Open for booking');
    expect(check(m, 'equipment')!.label).toBe('Your gooseneck works');
    expect(check(m, 'weight')!.label).toBe('8,000 lbs of your 10,000 lbs capacity');
    expect(check(m, 'length')!.label).toBe('30 ft fits your 40 ft deck');
    expect(check(m, 'deadhead')!.label).toBe('0 mi deadhead to pickup');
    expect(check(m, 'timing')!.label).toBe('Pickup opens 6h after you arrive');
    expect(check(m, 'rate')!.label).toBe(`$${m.effectiveRatePerMile.toFixed(2)}/mi all-in with deadhead`);
  });

  it('scores 1..100 as the weighted breakdown', () => {
    expect(Number.isInteger(m.score)).toBe(true);
    expect(m.score).toBeGreaterThanOrEqual(1);
    expect(m.score).toBeLessThanOrEqual(100);
    expect(m.score).toBe(Math.round(weightedScore(m.breakdown)));
    for (const value of Object.values(m.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('uses weights that add up to 1', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('reports the equipment the driver would use, in the order the load lists it', () => {
    expect(m.matchedEquipment).toEqual(['HS_GOOSENECK']);
    const both = match(makeLoad({ equipmentTypes: ['HS_DOVETAIL', 'FLATBED', 'HS_GOOSENECK'] }), hotshot({ equipmentTypes: ['HS_GOOSENECK', 'HS_DOVETAIL'] }));
    expect(both.matchedEquipment).toEqual(['HS_DOVETAIL', 'HS_GOOSENECK']);
    expect(check(both, 'equipment')!.label).toBe('Your dovetail works');
  });

  it('defaults the clock to the current time', () => {
    const live = makeLoad({
      pickupStart: new Date(Date.now() + HOUR_MS).toISOString(),
      pickupEnd: new Date(Date.now() + 10 * HOUR_MS).toISOString(),
    });
    expect(matchLoad(live, hotshot()).eligible).toBe(true);
    const stale = makeLoad({
      pickupStart: new Date(Date.now() - 10 * HOUR_MS).toISOString(),
      pickupEnd: new Date(Date.now() - HOUR_MS).toISOString(),
    });
    expect(check(matchLoad(stale, hotshot()), 'status')!.ok).toBe(false);
  });
});

describe('matchLoad: load status', () => {
  it.each([
    ['booked', 'Load is already booked'],
    ['in_transit', 'Load is already on the road'],
    ['delivered', 'Load was already delivered'],
    ['cancelled', 'Load was cancelled'],
  ] as const)('rejects a %s load', (status, label) => {
    const m = match(makeLoad({ status }), hotshot());
    expect(check(m, 'status')).toEqual({ key: 'status', ok: false, hard: true, label });
    expect(m.eligible).toBe(false);
    expect(m.score).toBe(0);
  });

  it('rejects an open load whose pickup window has passed', () => {
    const m = match(makeLoad({ pickupStart: at(-10), pickupEnd: at(-1) }), hotshot());
    expect(check(m, 'status')).toEqual({ key: 'status', ok: false, hard: true, label: 'Pickup window has passed' });
    expect(m.eligible).toBe(false);
  });

  it('still accepts a load whose window closes right now when the driver is already there', () => {
    const m = match(makeLoad({ pickupStart: at(-4), pickupEnd: at(0) }), hotshot());
    expect(check(m, 'status')!.ok).toBe(true);
    expect(check(m, 'timing')!.ok).toBe(true);
    expect(m.eligible).toBe(true);
  });
});

describe('matchLoad: equipment', () => {
  it('rejects a load that needs equipment the driver does not run', () => {
    const m = match(makeLoad({ equipmentTypes: ['DRY_VAN', 'REEFER'] }), semi());
    expect(check(m, 'equipment')).toEqual({ key: 'equipment', ok: false, hard: true, label: 'Needs Dry van or Reefer' });
    expect(m.matchedEquipment).toEqual([]);
    expect(m.eligible).toBe(false);
    expect(m.score).toBe(0);
  });

  it('says so when a load lists no equipment at all', () => {
    const m = match(makeLoad({ equipmentTypes: [] }), semi());
    expect(check(m, 'equipment')!.label).toBe('Needs unspecified equipment');
    expect(m.eligible).toBe(false);
  });

  it('accepts a load that takes either hotshot or semi equipment for both kinds of driver', () => {
    expect(match(makeLoad(), hotshot()).eligible).toBe(true);
    expect(match(makeLoad(), semi()).eligible).toBe(true);
    expect(match(makeLoad(), semi()).matchedEquipment).toEqual(['FLATBED']);
  });
});

describe('matchLoad: weight and length', () => {
  it('accepts a load at exactly the payload limit and rejects one pound over', () => {
    const driver = hotshot({ hasCdl: true, maxPayloadLbs: 16_500 });
    expect(check(match(makeLoad({ weightLbs: 16_500 }), driver), 'weight')!.ok).toBe(true);
    const over = match(makeLoad({ weightLbs: 16_501 }), driver);
    expect(check(over, 'weight')).toEqual({
      key: 'weight',
      ok: false,
      hard: true,
      label: 'Too heavy: 16,501 lbs over your 16,500 lbs limit',
    });
    expect(over.eligible).toBe(false);
  });

  it('accepts a load as long as the deck and rejects a longer one', () => {
    expect(check(match(makeLoad({ lengthFt: 40 }), hotshot()), 'length')!.ok).toBe(true);
    const long = match(makeLoad({ lengthFt: 41 }), hotshot());
    expect(check(long, 'length')).toEqual({ key: 'length', ok: false, hard: true, label: 'Too long: 41 ft on a 40 ft deck' });
    expect(long.eligible).toBe(false);
  });

  it('reports every failed check at once', () => {
    const m = match(makeLoad({ weightLbs: 30_000, lengthFt: 53 }), hotshot({ hasCdl: true }));
    expect(failed(m)).toEqual(['weight', 'length']);
    expect(m.score).toBe(0);
  });
});

describe('matchLoad: CDL rules', () => {
  // A non-CDL rig with a generous payload, so only the licensing rule can fail.
  const nonCdl = hotshot({ maxPayloadLbs: 16_500 });

  it('lets a non-CDL hotshot haul up to 10,000 lbs with no CDL check at all', () => {
    const m = match(makeLoad({ weightLbs: 10_000 }), nonCdl);
    expect(check(m, 'cdl')).toBeUndefined();
    expect(m.eligible).toBe(true);
  });

  it('requires a CDL once a hotshot load is over 10,000 lbs', () => {
    const m = match(makeLoad({ weightLbs: 10_001 }), nonCdl);
    expect(check(m, 'cdl')).toEqual({
      key: 'cdl',
      ok: false,
      hard: true,
      label: 'Over 10,000 lbs: needs a CDL (26,001+ lbs combination)',
    });
    expect(failed(m)).toEqual(['cdl']);
    expect(m.eligible).toBe(false);
  });

  it('lets a CDL hotshot haul past the non-CDL ceiling', () => {
    const m = match(makeLoad({ weightLbs: 16_000 }), hotshot({ hasCdl: true, maxPayloadLbs: 16_500 }));
    expect(check(m, 'cdl')).toBeUndefined();
    expect(m.eligible).toBe(true);
  });

  it('requires a Class A CDL for semi-only equipment', () => {
    const m = match(makeLoad({ equipmentTypes: ['FLATBED'], weightLbs: 5_000 }), semi({ hasCdl: false }));
    expect(check(m, 'equipment')!.ok).toBe(true);
    expect(check(m, 'cdl')).toEqual({ key: 'cdl', ok: false, hard: true, label: 'Requires a Class A CDL' });
    expect(m.eligible).toBe(false);
  });

  it('flags the CDL as well as the trailer when a non-CDL hotshot looks at a semi-only load', () => {
    const m = match(makeLoad({ equipmentTypes: ['DRY_VAN'], weightLbs: 5_000 }), hotshot());
    expect(failed(m)).toEqual(['equipment', 'cdl']);
    expect(check(m, 'cdl')!.label).toBe('Requires a Class A CDL');
  });

  it('judges the CDL rule by the equipment the driver would use, not every type the load accepts', () => {
    const m = match(makeLoad({ equipmentTypes: ['FLATBED', 'HS_GOOSENECK'], weightLbs: 9_000 }), hotshot());
    expect(check(m, 'cdl')).toBeUndefined();
    expect(m.eligible).toBe(true);
  });

  it('never adds a CDL check for a Class A holder, or a CDL with no class on file', () => {
    expect(check(match(makeLoad({ equipmentTypes: ['FLATBED'], weightLbs: 45_000 }), semi()), 'cdl')).toBeUndefined();
    const load = makeLoad({ equipmentTypes: ['FLATBED'], weightLbs: 45_000 });
    expect(check(match(load, semi({ cdlClass: 'A' })), 'cdl')).toBeUndefined();
    expect(check(match(load, semi({ cdlClass: null })), 'cdl')).toBeUndefined();
  });

  it('holds a Class B CDL to the non-CDL limits, since every rig here is a combination', () => {
    const semiLoad = match(makeLoad({ equipmentTypes: ['FLATBED'], weightLbs: 5_000 }), semi({ cdlClass: 'B' }));
    expect(check(semiLoad, 'cdl')).toEqual({
      key: 'cdl',
      ok: false,
      hard: true,
      label: 'Requires a Class A CDL (yours is Class B)',
    });
    expect(semiLoad.eligible).toBe(false);

    const classBHotshot = hotshot({ hasCdl: true, cdlClass: 'B', maxPayloadLbs: 16_500 });
    expect(check(match(makeLoad({ weightLbs: 10_000 }), classBHotshot), 'cdl')).toBeUndefined();
    expect(check(match(makeLoad({ weightLbs: 12_000 }), classBHotshot), 'cdl')!.label).toBe(
      'Over 10,000 lbs: needs a Class A CDL (yours is Class B)',
    );
  });
});

describe('matchLoad: hazmat', () => {
  it('adds no hazmat check to a non-hazmat load', () => {
    expect(check(match(makeLoad(), semi()), 'hazmat')).toBeUndefined();
  });

  it('accepts a hazmat load for a CDL holder with the H endorsement', () => {
    const m = match(makeLoad({ hazmat: true }), semi({ endorsements: ['hazmat'] }));
    expect(check(m, 'hazmat')).toEqual({ key: 'hazmat', ok: true, hard: true, label: 'Hazmat endorsement on file' });
    expect(m.eligible).toBe(true);
  });

  it.each([
    ['a CDL without the H endorsement', semi({ endorsements: ['tanker'] })],
    ['an H endorsement but no CDL on file', semi({ hasCdl: false, endorsements: ['hazmat'], equipmentTypes: ['FLATBED', 'HS_GOOSENECK'] })],
    ['a non-CDL hotshot', hotshot()],
  ])('rejects a hazmat load for a driver with %s', (_label, driver) => {
    const m = match(makeLoad({ hazmat: true }), driver);
    expect(check(m, 'hazmat')).toEqual({ key: 'hazmat', ok: false, hard: true, label: 'Hazmat: needs a CDL with H endorsement' });
    expect(m.eligible).toBe(false);
  });
});

describe('matchLoad: tanker', () => {
  const tankLoad = makeLoad({ equipmentTypes: ['TANKER'], weightLbs: 40_000, lengthFt: 40 });
  const tanker = (overrides: Partial<MatchableDriver> = {}) =>
    semi({ equipmentTypes: ['TANKER'], trailerLengthFt: 45, maxPayloadLbs: 45_000, ...overrides });

  it('marks TANKER as the one type that needs the N endorsement', () => {
    const needsN = Object.values(EQUIPMENT).filter((e) => e.requiresEndorsement === 'tanker');
    expect(needsN.map((e) => e.code)).toEqual(['TANKER']);
  });

  it('accepts a tanker-only load with the N endorsement', () => {
    const m = match(tankLoad, tanker({ endorsements: ['tanker'] }));
    expect(check(m, 'tanker')).toEqual({ key: 'tanker', ok: true, hard: true, label: 'Tanker endorsement on file' });
    expect(m.eligible).toBe(true);
  });

  it('rejects a tanker-only load without the N endorsement', () => {
    const m = match(tankLoad, tanker({ endorsements: ['hazmat'] }));
    expect(check(m, 'tanker')).toEqual({ key: 'tanker', ok: false, hard: true, label: 'Tanker: needs N endorsement' });
    expect(m.eligible).toBe(false);
  });

  it('rejects an N endorsement without a CDL', () => {
    const m = match(tankLoad, tanker({ hasCdl: false, endorsements: ['tanker'] }));
    expect(failed(m)).toEqual(['cdl', 'tanker']);
  });

  it('hauls pneumatic dry bulk (frac sand) without the N endorsement', () => {
    // Regression: dry bulk was posted as TANKER, but a tank vehicle under 49 CFR 383.5 carries
    // liquid or gas, so a pneumatic trailer needs no N endorsement.
    const sand = makeLoad({ equipmentTypes: ['DRY_BULK'], weightLbs: 45_000, lengthFt: 42 });
    const m = match(sand, tanker({ equipmentTypes: ['DRY_BULK'], endorsements: [] }));
    expect(check(m, 'tanker')).toBeUndefined();
    expect(m.matchedEquipment).toEqual(['DRY_BULK']);
    expect(m.eligible).toBe(true);
    expect(EQUIPMENT.DRY_BULK.driverClass).toBe('semi');
    expect(EQUIPMENT.DRY_BULK.requiresEndorsement).toBeUndefined();
    expect(EQUIPMENT.TANKER.description).not.toMatch(/dry bulk/i);
  });

  it('skips the tanker check when the driver can take the load on a non-tank trailer', () => {
    const mixed = makeLoad({ equipmentTypes: ['TANKER', 'FLATBED'], weightLbs: 40_000, lengthFt: 40 });
    const m = match(mixed, semi({ equipmentTypes: ['FLATBED', 'TANKER'] }));
    expect(m.matchedEquipment).toEqual(['TANKER', 'FLATBED']);
    expect(check(m, 'tanker')).toBeUndefined();
    expect(m.eligible).toBe(true);
  });
});

describe('matchLoad: team and avoided states', () => {
  it('only checks team when the load requires it', () => {
    expect(check(match(makeLoad(), semi()), 'team')).toBeUndefined();
    const team = makeLoad({ teamRequired: true });
    expect(check(match(team, semi({ teamDriver: true })), 'team')).toEqual({
      key: 'team',
      ok: true,
      hard: true,
      label: 'Team load and you run team',
    });
    const solo = match(team, semi({ teamDriver: false }));
    expect(check(solo, 'team')).toEqual({ key: 'team', ok: false, hard: true, label: 'Team drivers required' });
    expect(solo.eligible).toBe(false);
  });

  it('rejects a load delivering to a state on the avoid list', () => {
    const m = match(makeLoad(), hotshot({ avoidStates: ['NM', 'TX'] }));
    expect(check(m, 'avoid_state')).toEqual({
      key: 'avoid_state',
      ok: false,
      hard: true,
      label: 'Delivers to TX, which is on your avoid list',
    });
    expect(m.eligible).toBe(false);
  });

  it('judges the avoid list by the delivery state only', () => {
    const outOfState = makeLoad({ destination: place('shreveport-la') });
    expect(check(match(outOfState, hotshot({ avoidStates: ['TX'] })), 'avoid_state')).toBeUndefined();
    expect(check(match(makeLoad(), hotshot({ avoidStates: ['LA'] })), 'avoid_state')).toBeUndefined();
  });
});

describe('matchLoad: deadhead', () => {
  it('treats a driver with no location as unknown deadhead, not a failure', () => {
    const m = match(makeLoad(), hotshot({ currentLocation: null }));
    expect(m.deadheadMiles).toBeNull();
    expect(check(m, 'deadhead')).toEqual({ key: 'deadhead', ok: true, hard: false, label: 'Set your location to see deadhead' });
    expect(m.breakdown.deadhead).toBe(60);
    expect(m.totalMiles).toBe(m.loadedMiles);
    expect(m.eligible).toBe(true);
  });

  it('measures road miles from the driver to pickup', () => {
    const m = match(makeLoad(), hotshot({ currentLocation: place('pasadena-tx') }));
    const expected = roadMiles(place('pasadena-tx'), place('houston-tx'));
    expect(m.deadheadMiles).toBe(expected);
    expect(check(m, 'deadhead')).toEqual({ key: 'deadhead', ok: true, hard: true, label: `${expected} mi deadhead to pickup` });
    expect(m.breakdown.deadhead).toBe(Math.round(100 * (1 - expected / 150)));
  });

  it('accepts deadhead exactly at the limit', () => {
    const miles = roadMiles(place('beaumont-tx'), place('houston-tx'));
    const m = match(makeLoad(), hotshot({ currentLocation: place('beaumont-tx'), maxDeadheadMiles: miles }));
    expect(check(m, 'deadhead')!.ok).toBe(true);
    expect(m.breakdown.deadhead).toBe(0);
    expect(m.eligible).toBe(true);
  });

  it('rejects deadhead over the limit as a hard failure', () => {
    const driver = hotshot({ currentLocation: place('dallas-tx') });
    const m = match(makeLoad(), driver);
    expect(check(m, 'deadhead')).toEqual({
      key: 'deadhead',
      ok: false,
      hard: true,
      label: `${m.deadheadMiles} mi deadhead, over your 150 mi limit`,
    });
    expect(m.deadheadMiles).toBeGreaterThan(150);
    expect(m.eligible).toBe(false);
    expect(m.score).toBe(0);
  });

  it('turns an over-limit deadhead into a soft check with ignoreDeadheadLimit', () => {
    const m = match(makeLoad(), hotshot({ currentLocation: place('dallas-tx') }), { ignoreDeadheadLimit: true });
    expect(check(m, 'deadhead')).toMatchObject({ ok: false, hard: false });
    expect(m.breakdown.deadhead).toBe(0);
    expect(m.eligible).toBe(true);
    expect(m.score).toBeGreaterThan(0);
  });

  it('does not change a within-limit result when ignoreDeadheadLimit is set', () => {
    const driver = hotshot({ currentLocation: place('pasadena-tx') });
    expect(match(makeLoad(), driver, { ignoreDeadheadLimit: true })).toEqual(match(makeLoad(), driver));
  });

  it('handles a zero-mile limit for a driver already at pickup', () => {
    const m = match(makeLoad(), hotshot({ maxDeadheadMiles: 0 }));
    expect(m.deadheadMiles).toBe(0);
    expect(check(m, 'deadhead')!.ok).toBe(true);
    expect(m.breakdown.deadhead).toBe(100);
  });
});

describe('matchLoad: timing', () => {
  // Dallas is 263 road miles from Houston: about 5.3 hours at the planning speed.
  const fromDallas = hotshot({ currentLocation: place('dallas-tx'), maxDeadheadMiles: 500 });

  it('rejects a pickup the driver cannot reach before the window closes', () => {
    const m = match(makeLoad({ pickupStart: at(-5), pickupEnd: at(2) }), fromDallas);
    expect(check(m, 'timing')).toEqual({ key: 'timing', ok: false, hard: true, label: "Can't reach pickup in time (about 3h late)" });
    expect(m.breakdown.timing).toBe(0);
    expect(m.eligible).toBe(false);
  });

  it('keeps timing a hard check even with ignoreDeadheadLimit', () => {
    const m = match(makeLoad({ pickupStart: at(-5), pickupEnd: at(2) }), fromDallas, { ignoreDeadheadLimit: true });
    expect(check(m, 'timing')!.hard).toBe(true);
    expect(m.eligible).toBe(false);
  });

  it('says at least 1h late when the driver misses by minutes', () => {
    const m = match(makeLoad({ pickupStart: at(-5), pickupEnd: at(5) }), fromDallas);
    expect(check(m, 'timing')!.label).toBe("Can't reach pickup in time (about 1h late)");
  });

  it('rejects a load whose window closes before the driver is available', () => {
    const m = match(makeLoad({ pickupStart: at(6), pickupEnd: at(30) }), hotshot({ availableFrom: at(40) }));
    expect(check(m, 'timing')).toMatchObject({ ok: false, label: "Can't reach pickup in time (about 10h late)" });
    expect(m.eligible).toBe(false);
  });

  it('counts the drive from when the driver becomes available', () => {
    const m = match(makeLoad({ pickupStart: at(6), pickupEnd: at(30) }), hotshot({ availableFrom: at(20) }));
    expect(check(m, 'timing')).toMatchObject({ ok: true, label: 'You can make the pickup window' });
  });

  it('ignores an availableFrom that has already passed', () => {
    expect(match(makeLoad(), hotshot({ availableFrom: at(-48) }))).toEqual(match(makeLoad(), hotshot()));
  });

  it('describes the wait before pickup opens', () => {
    const label = (start: number) => check(match(makeLoad({ pickupStart: at(start), pickupEnd: at(start + 10) }), hotshot()), 'timing')!.label;
    expect(label(-1)).toBe('You can make the pickup window');
    expect(label(0.5)).toBe('Pickup opens shortly after you arrive');
    expect(label(6)).toBe('Pickup opens 6h after you arrive');
    expect(label(47)).toBe('Pickup opens 47h after you arrive');
    expect(label(72)).toBe('Pickup opens 3 days after you arrive');
  });

  it('scores a short wait fully and lowers the score for a long wait', () => {
    const timing = (start: number) => match(makeLoad({ pickupStart: at(start), pickupEnd: at(start + 10) }), hotshot()).breakdown.timing;
    expect(timing(0)).toBe(100);
    expect(timing(12)).toBe(100);
    expect(timing(54)).toBe(60);
    expect(timing(108)).toBe(20);
    expect(timing(400)).toBe(20);
    const soon = match(makeLoad({ pickupStart: at(6), pickupEnd: at(16) }), hotshot());
    const later = match(makeLoad({ pickupStart: at(80), pickupEnd: at(90) }), hotshot());
    expect(later.eligible).toBe(true);
    expect(later.score).toBeLessThan(soon.score);
  });

  it('scores the wait from when the driver is ready, so deadhead hours never count as less waiting', () => {
    const load = makeLoad({ pickupStart: at(50), pickupEnd: at(60) });
    const near = match(load, hotshot());
    const far = match(load, hotshot({ currentLocation: place('dallas-tx'), maxDeadheadMiles: 500 }));
    expect(far.breakdown.timing).toBe(near.breakdown.timing);
  });

  it('adds the 10-hour break hours of service require after 11 hours of driving', () => {
    // Regression: the deadhead was timed as non-stop driving, so pickups that need a mandatory
    // break were called reachable.
    const fromElPaso = hotshot({ currentLocation: place('el-paso-tx'), maxDeadheadMiles: 1_000 });
    const miles = roadMiles(place('el-paso-tx'), place('houston-tx'));
    expect(driveHours(miles)).toBeGreaterThan(11);
    expect(driveHours(miles)).toBeLessThan(22);
    expect(transitHours(miles)).toBe(driveHours(miles) + 10);

    const sameDay = makeLoad({ pickupStart: at(2), pickupEnd: at(Math.ceil(driveHours(miles)) + 1) });
    const m = match(sameDay, fromElPaso, { ignoreDeadheadLimit: true });
    expect(check(m, 'timing')).toMatchObject({ ok: false, hard: true });
    expect(m.eligible).toBe(false);

    const nextDay = makeLoad({ pickupStart: at(2), pickupEnd: at(Math.ceil(transitHours(miles)) + 1) });
    expect(check(match(nextDay, fromElPaso, { ignoreDeadheadLimit: true }), 'timing')).toMatchObject({
      ok: true,
      label: 'You can make the pickup window',
    });
  });

  it('needs no break for a deadhead of 11 hours or less', () => {
    // Dallas is about 5 hours out, so a window closing in 6 hours is reachable.
    expect(transitHours(roadMiles(place('dallas-tx'), place('houston-tx')))).toBe(driveHours(263));
    expect(check(match(makeLoad({ pickupStart: at(-5), pickupEnd: at(6) }), fromDallas), 'timing')!.ok).toBe(true);
  });

  it('prefers a driver who frees up close to pickup over one sitting idle', () => {
    const load = makeLoad({ pickupStart: at(50), pickupEnd: at(60) });
    const idle = match(load, hotshot());
    const busy = match(load, hotshot({ availableFrom: at(44) }));
    expect(busy.breakdown.timing).toBe(100);
    expect(idle.breakdown.timing).toBeLessThan(100);
    expect(busy.score).toBeGreaterThan(idle.score);
  });
});

describe('matchLoad: money', () => {
  const driver = hotshot({ mpg: 10, fuelPricePerGallon: 4 });

  it('computes fuel and profit for the loaded run', () => {
    const m = match(makeLoad({ miles: 400, rateUsd: 1_400 }), driver);
    expect(m).toMatchObject({
      deadheadMiles: 0,
      loadedMiles: 400,
      totalMiles: 400,
      effectiveRatePerMile: 3.5,
      fuelCostUsd: 160,
      estimatedProfitUsd: 1_240,
    });
  });

  it('includes deadhead in total miles, fuel and the effective rate', () => {
    const m = match(makeLoad({ miles: 400, rateUsd: 1_400 }), { ...driver, currentLocation: place('pasadena-tx') });
    const deadhead = roadMiles(place('pasadena-tx'), place('houston-tx'));
    expect(m.deadheadMiles).toBe(deadhead);
    expect(m.totalMiles).toBe(400 + deadhead);
    expect(m.effectiveRatePerMile).toBe(Math.round((1_400 / (400 + deadhead)) * 100) / 100);
    expect(m.fuelCostUsd).toBe(Math.round(((400 + deadhead) / 10) * 4));
    expect(m.estimatedProfitUsd).toBe(1_400 - m.fuelCostUsd);
  });

  it('rounds the effective rate to cents and fuel to whole dollars', () => {
    const m = match(makeLoad({ miles: 333, rateUsd: 1_000 }), hotshot({ mpg: 7, fuelPricePerGallon: 3.33 }));
    expect(m.effectiveRatePerMile).toBe(3);
    expect(m.fuelCostUsd).toBe(158);
    expect(m.estimatedProfitUsd).toBe(842);
  });

  it('can report a loss when fuel costs more than the load pays', () => {
    const m = match(makeLoad({ miles: 1_000, rateUsd: 300 }), semi({ mpg: 5, fuelPricePerGallon: 5 }));
    expect(m.fuelCostUsd).toBe(1_000);
    expect(m.estimatedProfitUsd).toBe(-700);
  });

  it('guards against zero loaded miles and a zero mpg', () => {
    const m = match(makeLoad({ miles: 0, rateUsd: 500 }), hotshot({ mpg: 0, fuelPricePerGallon: 4 }));
    expect(m.loadedMiles).toBe(1);
    expect(m.totalMiles).toBe(1);
    expect(m.effectiveRatePerMile).toBe(500);
    expect(m.fuelCostUsd).toBe(4);
  });

  it('flags a rate under the driver minimum as a soft check only', () => {
    const m = match(makeLoad({ miles: 400, rateUsd: 400 }), hotshot({ minRatePerMile: 1.5 }));
    expect(check(m, 'rate')).toEqual({
      key: 'rate',
      ok: false,
      hard: false,
      label: '$1.00/mi with deadhead, under your $1.50/mi minimum',
    });
    expect(m.eligible).toBe(true);
    expect(m.score).toBeGreaterThan(0);
  });

  it('accepts a rate exactly at the driver minimum', () => {
    const m = match(makeLoad({ miles: 400, rateUsd: 600 }), hotshot({ minRatePerMile: 1.5 }));
    expect(check(m, 'rate')).toMatchObject({ ok: true, label: '$1.50/mi all-in with deadhead' });
  });
});

describe('matchLoad: score components', () => {
  /** What the market pays for a run of this many miles on a gooseneck (the hotshot fixture's rig). */
  const gooseneckMarket = (miles: number) => estimateRate(miles, ['HS_GOOSENECK']).suggestedUsd;
  /** Rate component for a 1,000 mi load posted at `ratio` times the lane market, driver at pickup. */
  const rateScoreAt = (ratio: number, minRatePerMile = 0) =>
    match(makeLoad({ miles: 1_000, rateUsd: Math.round(ratio * gooseneckMarket(1_000)) }), hotshot({ minRatePerMile })).breakdown
      .rate;

  it('scores pay against the lane market: 0 at 70%, 60 at market', () => {
    expect(rateScoreAt(0.6)).toBe(0);
    expect(rateScoreAt(0.7)).toBe(0);
    expect(rateScoreAt(0.9)).toBe(46);
    expect(rateScoreAt(1)).toBe(60);
    expect(rateScoreFor(0)).toBe(0);
    expect(rateScoreFor(1)).toBe(60);
  });

  it('keeps rewarding pay well past 120% of market instead of flattening out', () => {
    // Regression: the component used to max out at 120%, so pay above that stopped counting.
    expect(rateScoreAt(1.2)).toBe(78);
    expect(rateScoreAt(1.5)).toBe(91);
    expect(rateScoreAt(2)).toBe(98);
    expect(rateScoreAt(3)).toBe(100);
    const scores = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2].map((ratio) => rateScoreAt(ratio));
    for (let i = 1; i < scores.length; i += 1) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it('caps the rate score at 30 when the load pays under the driver minimum', () => {
    expect(rateScoreAt(2, 5)).toBe(30);
    expect(rateScoreAt(0.6, 5)).toBe(0);
  });

  it('prices the market for the whole run, deadhead included', () => {
    const load = makeLoad({ miles: 400, rateUsd: 1_200 });
    const driver = hotshot({ currentLocation: place('beaumont-tx') });
    const m = match(load, driver);
    expect(marketRateFor(load, ['HS_GOOSENECK'], m.totalMiles)).toBe(gooseneckMarket(m.totalMiles));
    expect(m.breakdown.rate).toBe(rateScoreFor(1_200 / gooseneckMarket(m.totalMiles)));
    expect(m.breakdown.rate).toBeLessThan(match(load, hotshot()).breakdown.rate);
  });

  it('scores a short hop and a long run posted at the suggested price the same', () => {
    // Regression: a flat $/mi benchmark ignored the minimum charge and short-haul premium, so every
    // short hop posted at market scored 100 on rate, said "Pays above market" and topped the board.
    for (const destination of ['pasadena-tx', 'baytown-tx', 'beaumont-tx', 'austin-tx', 'dallas-tx', 'odessa-tx', 'el-paso-tx']) {
      const draft = makeLoad({ destination: place(destination) });
      const atMarket = { ...draft, rateUsd: estimateRate(draft.miles, draft.equipmentTypes, draft).suggestedUsd };
      const m = match(atMarket, hotshot({ minRatePerMile: 0 }));
      expect(m.breakdown.rate, destination).toBe(60);
      expect(m.highlights, destination).not.toContain('Pays above market');
    }
  });

  it('ranks a long run above a short hop when both pay the same share of market', () => {
    const shortHop = makeLoad({ destination: place('baytown-tx') });
    const longRun = makeLoad({ destination: place('el-paso-tx') });
    const at = (load: MatchableLoad, ratio: number) => ({
      ...load,
      rateUsd: Math.round(ratio * estimateRate(load.miles, ['HS_GOOSENECK']).suggestedUsd),
    });
    const hop = match(at(shortHop, 1.15), hotshot());
    const run = match(at(longRun, 1.15), hotshot());
    expect(hop.breakdown.rate).toBe(run.breakdown.rate);
    expect(compareMatches(run, hop)).toBeLessThan(0);
  });

  it('never calls a short hop under the market low "above market"', () => {
    // Odessa -> Midland is a 23 mi hop: $150 is half of the minimum charge.
    const hop = makeLoad({ origin: place('odessa-tx'), destination: place('midland-tx'), rateUsd: 150 });
    expect(hop.rateUsd).toBeLessThan(estimateRate(hop.miles, ['HS_GOOSENECK']).lowUsd);
    const m = match(hop, hotshot({ currentLocation: place('odessa-tx'), minRatePerMile: 0 }));
    expect(m.breakdown.rate).toBe(0);
    expect(m.highlights).not.toContain('Pays above market');
    const sanAntonio = makeLoad({ origin: place('odessa-tx'), destination: place('san-antonio-tx') });
    const wellPaid = { ...sanAntonio, rateUsd: Math.round(1.15 * estimateRate(sanAntonio.miles, ['HS_GOOSENECK']).suggestedUsd) };
    const run = match(wellPaid, hotshot({ currentLocation: place('odessa-tx'), minRatePerMile: 0 }));
    expect(run.highlights).toContain('Pays above market');
    expect(run.score).toBeGreaterThan(m.score);
  });

  it('ranks a load paying far more above one a few deadhead miles closer', () => {
    // Regression: both maxed the rate component, so the closer, poorer load won on deadhead.
    const cody = hotshot({ currentLocation: place('odessa-tx'), minRatePerMile: 0 });
    const fromOdessa = makeLoad({ origin: place('odessa-tx'), destination: place('houston-tx') });
    const fromMidland = makeLoad({ origin: place('midland-tx'), destination: place('houston-tx') });
    const near = match({ ...fromOdessa, rateUsd: Math.round(1.25 * gooseneckMarket(fromOdessa.miles)) }, cody);
    const richer = match({ ...fromMidland, rateUsd: Math.round(1.75 * gooseneckMarket(fromMidland.miles)) }, cody);
    expect(richer.deadheadMiles).toBeGreaterThan(near.deadheadMiles!);
    expect(richer.estimatedProfitUsd).toBeGreaterThan(near.estimatedProfitUsd + 500);
    expect(compareMatches(richer, near)).toBeLessThan(0);
  });

  it('judges the rate by the equipment the driver would use', () => {
    const load = makeLoad({ miles: 1_000, rateUsd: gooseneckMarket(1_000) });
    expect(match(load, hotshot()).breakdown.rate).toBe(60);
    const flatbedMarket = estimateRate(1_000, ['FLATBED']).suggestedUsd;
    expect(match(load, semi({ minRatePerMile: 0 })).breakdown.rate).toBe(rateScoreFor(load.rateUsd / flatbedMarket));
  });

  it('judges the rate on the cheapest of the matched equipment, like the rate estimate', () => {
    // Regression: the priciest matched trailer set the bar, so a load that took both of the driver's
    // trailers scored lower than an otherwise identical load that took only one.
    const marcus = semi({
      equipmentTypes: ['FLATBED', 'STEP_DECK'],
      trailerLengthFt: 48,
      currentLocation: place('dallas-tx'),
      minRatePerMile: 0,
    });
    const freight = { origin: place('dallas-tx'), destination: place('houston-tx'), weightLbs: 40_000, lengthFt: 45 };
    const flatbedOnly = makeLoad({ ...freight, equipmentTypes: ['FLATBED'] });
    const rateUsd = estimateRate(flatbedOnly.miles, ['FLATBED']).suggestedUsd;
    const either = match(makeLoad({ ...freight, equipmentTypes: ['FLATBED', 'STEP_DECK'], rateUsd }), marcus);
    const one = match({ ...flatbedOnly, rateUsd }, marcus);
    expect(either.matchedEquipment).toEqual(['FLATBED', 'STEP_DECK']);
    expect(either.breakdown.rate).toBe(60);
    expect(either.breakdown).toEqual(one.breakdown);
    expect(either.eligible).toBe(true);
    expect(either.score).toBe(one.score);
  });

  it('scores fit from 60 for a small load up to 100 at 80% of capacity', () => {
    const fit = (weightLbs: number, lengthFt: number) => match(makeLoad({ weightLbs, lengthFt }), hotshot()).breakdown.fit;
    expect(fit(8_000, 10)).toBe(100);
    expect(fit(1_000, 32)).toBe(100);
    expect(fit(2_000, 8)).toBe(70);
    expect(fit(1, 1)).toBe(61);
  });
});

describe('matchLoad: monotonicity', () => {
  const pickup = place('houston-tx');
  const nearby = CITIES.map((c) => ({ id: c.id, miles: roadMiles(c, pickup) }))
    .filter((c) => c.miles <= 1_000)
    .sort((a, b) => a.miles - b.miles);

  const scoresByDeadhead = (load: MatchableLoad, driver: (cityId: string) => MatchableDriver, opts: MatchOptions = {}) =>
    nearby.map(({ id, miles }) => ({ id, miles, m: match(load, driver(id), opts) })).filter((r) => r.m.eligible);

  const expectNonIncreasing = (rows: { id: string; miles: number; m: MatchResult }[]) => {
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].miles === rows[i - 1].miles) continue;
      expect(rows[i].m.score, `${rows[i].id} (${rows[i].miles} mi) vs ${rows[i - 1].id} (${rows[i - 1].miles} mi)`).toBeLessThanOrEqual(
        rows[i - 1].m.score,
      );
    }
  };

  it('never scores a farther driver above a closer one within the deadhead limit', () => {
    const load = makeLoad({ pickupStart: at(50), pickupEnd: at(80), rateUsd: 2_000 });
    const rows = scoresByDeadhead(load, (id) => hotshot({ currentLocation: place(id), maxDeadheadMiles: 1_000 }));
    expect(rows.length).toBeGreaterThan(100);
    expectNonIncreasing(rows);
  });

  it('never scores a farther driver above a closer one when the deadhead limit is ignored', () => {
    // A well-paid load that opens in two days, for drivers over a 100 mi limit: the deadhead
    // component is 0 for most of them, so only the rate (market for the whole run) and timing
    // could tell them apart.
    const load = makeLoad({ pickupStart: at(50), pickupEnd: at(80), rateUsd: 4_000 });
    const rows = scoresByDeadhead(
      load,
      (id) => hotshot({ currentLocation: place(id), maxDeadheadMiles: 100 }),
      { ignoreDeadheadLimit: true },
    );
    expect(rows.filter((r) => r.miles > 100).length).toBeGreaterThan(100);
    expectNonIncreasing(rows);
  });

  it('never scores a farther semi above a closer one', () => {
    const load = makeLoad({ equipmentTypes: ['FLATBED'], weightLbs: 40_000, lengthFt: 48, rateUsd: 1_500, pickupStart: at(2), pickupEnd: at(40) });
    const rows = scoresByDeadhead(load, (id) => semi({ currentLocation: place(id), maxDeadheadMiles: 1_000 }));
    expectNonIncreasing(rows);
  });

  it('never scores a better-paying load below a worse-paying one', () => {
    for (const driver of [hotshot(), hotshot({ currentLocation: place('beaumont-tx'), minRatePerMile: 2.5 }), semi()]) {
      let previous = -1;
      for (let rateUsd = 100; rateUsd <= 6_000; rateUsd += 25) {
        const m = match(makeLoad({ rateUsd }), driver);
        expect(m.eligible).toBe(true);
        expect(m.score).toBeGreaterThanOrEqual(previous);
        previous = m.score;
      }
    }
  });
});

describe('matchLoad: lane and highlights', () => {
  it('scores the lane 50 with no home base or preferred states', () => {
    const m = match(makeLoad(), hotshot());
    expect(m.breakdown.lane).toBe(50);
    expect(m.highlights).not.toContain('Heads toward home');
  });

  it('scores a preferred delivery state 100 and calls it out', () => {
    const m = match(makeLoad(), hotshot({ preferredStates: ['OK', 'TX'] }));
    expect(m.breakdown.lane).toBe(100);
    expect(m.highlights).toContain('Delivers to TX, a preferred state');
  });

  it('scores a load that runs toward home by how much of the way home it covers', () => {
    const home = place('midland-tx');
    const fromHome = roadMiles(place('houston-tx'), home);
    const dropFromHome = roadMiles(place('odessa-tx'), home);
    const m = match(makeLoad(), hotshot({ homeBase: home }));
    expect(m.breakdown.lane).toBe(Math.round(60 + 40 * ((fromHome - dropFromHome) / fromHome)));
    expect(m.highlights).toContain('Heads toward home');
  });

  it('scores a delivery right at home 100', () => {
    const m = match(makeLoad(), hotshot({ homeBase: place('odessa-tx') }));
    expect(m.breakdown.lane).toBe(100);
    expect(m.highlights).toContain('Heads toward home');
  });

  it('scores a load that runs away from home 40, unless it delivers to a preferred state', () => {
    const awayFromHome = hotshot({ homeBase: place('beaumont-tx') });
    const m = match(makeLoad(), awayFromHome);
    expect(m.breakdown.lane).toBe(40);
    expect(m.highlights).not.toContain('Heads toward home');
    expect(match(makeLoad(), { ...awayFromHome, preferredStates: ['TX'] }).breakdown.lane).toBe(100);
  });

  it('does not call a load from near home "toward home"', () => {
    const m = match(makeLoad({ destination: place('pasadena-tx') }), hotshot({ homeBase: place('pearland-tx') }));
    expect(roadMiles(place('houston-tx'), place('pearland-tx'))).toBeLessThanOrEqual(50);
    expect(m.highlights).not.toContain('Heads toward home');
    expect(m.breakdown.lane).toBe(40);
  });

  it('does not call a load "toward home" when it barely closes the distance', () => {
    const home = place('dallas-tx');
    const load = makeLoad({ destination: place('austin-tx') });
    const fromHome = roadMiles(load.origin, home);
    const dropFromHome = roadMiles(load.destination, home);
    expect(dropFromHome).toBeLessThan(fromHome);
    expect((fromHome - dropFromHome) / fromHome).toBeLessThan(0.25);
    const m = match(load, hotshot({ homeBase: home }));
    expect(m.highlights).not.toContain('Heads toward home');
    expect(m.breakdown.lane).toBe(40);
  });

  it('calls out a pickup within 25 miles', () => {
    const within = roadMiles(place('sugar-land-tx'), place('houston-tx'));
    const beyond = roadMiles(place('baytown-tx'), place('houston-tx'));
    expect(within).toBeLessThanOrEqual(25);
    expect(beyond).toBeGreaterThan(25);
    expect(match(makeLoad(), hotshot({ currentLocation: place('sugar-land-tx') })).highlights).toContain('Pickup is close by');
    expect(match(makeLoad(), hotshot({ currentLocation: place('baytown-tx') })).highlights).not.toContain('Pickup is close by');
    expect(match(makeLoad(), hotshot({ currentLocation: null })).highlights).not.toContain('Pickup is close by');
  });

  it('calls out pay at least 10% above the lane market', () => {
    const line = (estimateRate(400, ['HS_GOOSENECK']).suggestedUsd * 11) / 10;
    expect(match(makeLoad({ miles: 400, rateUsd: Math.ceil(line) }), hotshot()).highlights).toContain('Pays above market');
    expect(match(makeLoad({ miles: 400, rateUsd: Math.ceil(line) - 1 }), hotshot()).highlights).not.toContain('Pays above market');
  });

  it('calls out hotshot-ready freight for hotshot drivers only', () => {
    expect(match(makeLoad(), hotshot()).highlights).toContain('Hotshot-ready freight');
    expect(match(makeLoad(), semi()).highlights).not.toContain('Hotshot-ready freight');
  });

  it('lists highlights in a stable order', () => {
    const m = match(makeLoad({ miles: 400, rateUsd: 2_000 }), hotshot({ homeBase: place('odessa-tx'), preferredStates: ['TX'] }));
    expect(m.highlights).toEqual([
      'Pickup is close by',
      'Pays above market',
      'Heads toward home',
      'Delivers to TX, a preferred state',
      'Hotshot-ready freight',
    ]);
  });

  it('gives an ineligible load no highlights', () => {
    const m = match(makeLoad({ weightLbs: 12_000, rateUsd: 5_000 }), hotshot({ preferredStates: ['TX'], homeBase: place('odessa-tx') }));
    expect(m.eligible).toBe(false);
    expect(m.highlights).toEqual([]);
  });
});

describe('compareMatches', () => {
  const base = match(makeLoad(), hotshot());
  const result = (overrides: Partial<MatchResult>): MatchResult => ({ ...base, ...overrides });

  it('puts eligible matches before ineligible ones whatever their score', () => {
    const ineligible = result({ eligible: false, score: 0, estimatedProfitUsd: 9_000 });
    const eligible = result({ eligible: true, score: 5, estimatedProfitUsd: 10 });
    expect(compareMatches(eligible, ineligible)).toBeLessThan(0);
    expect(compareMatches(ineligible, eligible)).toBeGreaterThan(0);
  });

  it('orders by score, then by estimated profit', () => {
    const high = result({ score: 90, estimatedProfitUsd: 100 });
    const low = result({ score: 70, estimatedProfitUsd: 5_000 });
    const lowRich = result({ score: 70, estimatedProfitUsd: 6_000 });
    expect(compareMatches(high, low)).toBeLessThan(0);
    expect(compareMatches(lowRich, low)).toBeLessThan(0);
    expect([low, high, lowRich].sort(compareMatches)).toEqual([high, lowRich, low]);
  });

  it('treats identical score and profit as a tie', () => {
    expect(compareMatches(result({}), result({}))).toBe(0);
  });

  it('puts missing matches last', () => {
    const ineligible = result({ eligible: false, score: 0 });
    expect(compareMatches(null, ineligible)).toBeGreaterThan(0);
    expect(compareMatches(ineligible, null)).toBeLessThan(0);
    expect(compareMatches(null, null)).toBe(0);
    expect([null, ineligible, base, null].sort(compareMatches)).toEqual([base, ineligible, null, null]);
  });
});
