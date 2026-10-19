import { describe, expect, it } from 'vitest';
import { placeForCityId } from '../../shared/cities';
import {
  AVERAGE_SPEED_MPH,
  driveHours,
  haversineMiles,
  HOS_BREAK_HOURS,
  HOS_MAX_DRIVING_HOURS,
  isStateCode,
  ROAD_CIRCUITY_FACTOR,
  roadMiles,
  STATE_CODES,
  transitHours,
  US_STATES,
} from '../../shared/geo';

const city = (id: string) => {
  const p = placeForCityId(id);
  if (!p) throw new Error(`unknown city ${id}`);
  return p;
};
const EARTH_RADIUS_MILES = 3958.8;

describe('haversineMiles', () => {
  // Published great-circle distances between city centres, in statute miles.
  it.each([
    ['dallas-tx', 'houston-tx', 225],
    ['seattle-wa', 'portland-or', 145],
    ['denver-co', 'phoenix-az', 586],
    ['atlanta-ga', 'miami-fl', 605],
    ['chicago-il', 'houston-tx', 940],
    ['new-york-ny', 'los-angeles-ca', 2_445],
  ])('puts %s to %s at about %i miles', (a, b, miles) => {
    expect(Math.abs(haversineMiles(city(a), city(b)) - miles)).toBeLessThanOrEqual(Math.max(3, miles * 0.01));
  });

  it('measures one degree of latitude or of longitude on the equator as about 69.1 miles', () => {
    const degree = (2 * Math.PI * EARTH_RADIUS_MILES) / 360;
    expect(haversineMiles({ lat: 30, lng: -95 }, { lat: 31, lng: -95 })).toBeCloseTo(degree, 6);
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(degree, 6);
  });

  it('shrinks a degree of longitude toward the poles', () => {
    const atEquator = haversineMiles({ lat: 0, lng: -100 }, { lat: 0, lng: -101 });
    const atFortyFive = haversineMiles({ lat: 45, lng: -100 }, { lat: 45, lng: -101 });
    expect(atFortyFive / atEquator).toBeCloseTo(Math.cos(Math.PI / 4), 3);
  });

  it('is zero for the same point', () => {
    expect(haversineMiles(city('houston-tx'), city('houston-tx'))).toBe(0);
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });

  it('is symmetric', () => {
    const pairs = [
      ['dallas-tx', 'houston-tx'],
      ['odessa-tx', 'new-york-ny'],
      ['anchorage-ak', 'honolulu-hi'],
    ];
    for (const [a, b] of pairs) expect(haversineMiles(city(a), city(b))).toBe(haversineMiles(city(b), city(a)));
  });

  it('obeys the triangle inequality', () => {
    const [a, b, c] = [city('houston-tx'), city('dallas-tx'), city('odessa-tx')];
    expect(haversineMiles(a, c)).toBeLessThanOrEqual(haversineMiles(a, b) + haversineMiles(b, c));
  });

  it('stays finite for antipodal points', () => {
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_MILES, 6);
  });
});

describe('roadMiles', () => {
  it('pads straight-line miles by the trucking circuity factor and rounds to a mile', () => {
    expect(ROAD_CIRCUITY_FACTOR).toBe(1.17);
    expect(roadMiles(city('dallas-tx'), city('houston-tx'))).toBe(Math.round(haversineMiles(city('dallas-tx'), city('houston-tx')) * 1.17));
    expect(roadMiles(city('dallas-tx'), city('houston-tx'))).toBe(263);
  });

  it('lands near real driving distances for common freight lanes', () => {
    // Interstate driving miles: Dallas-Houston ~240 (I-45), Chicago-Houston ~1,085, New York-Los Angeles ~2,790.
    expect(roadMiles(city('dallas-tx'), city('houston-tx'))).toBeGreaterThan(230);
    expect(roadMiles(city('dallas-tx'), city('houston-tx'))).toBeLessThan(290);
    expect(Math.abs(roadMiles(city('chicago-il'), city('houston-tx')) - 1_085) / 1_085).toBeLessThan(0.1);
    expect(Math.abs(roadMiles(city('new-york-ny'), city('los-angeles-ca')) - 2_790) / 2_790).toBeLessThan(0.1);
  });

  it('is zero for the same city and symmetric', () => {
    expect(roadMiles(city('odessa-tx'), city('odessa-tx'))).toBe(0);
    expect(roadMiles(city('odessa-tx'), city('midland-tx'))).toBe(roadMiles(city('midland-tx'), city('odessa-tx')));
  });

  it('always returns a whole number of miles', () => {
    expect(Number.isInteger(roadMiles({ lat: 30.1, lng: -95.2 }, { lat: 31.37, lng: -97.81 }))).toBe(true);
  });
});

describe('driveHours', () => {
  it('plans at 50 mph including stops', () => {
    expect(AVERAGE_SPEED_MPH).toBe(50);
    expect(driveHours(0)).toBe(0);
    expect(driveHours(50)).toBe(1);
    expect(driveHours(500)).toBe(10);
    expect(driveHours(125)).toBe(2.5);
  });
});

describe('transitHours', () => {
  it('uses the hours-of-service limits: 11 h of driving, then a 10 h break', () => {
    expect(HOS_MAX_DRIVING_HOURS).toBe(11);
    expect(HOS_BREAK_HOURS).toBe(10);
  });

  it('adds no break to a run of 11 hours of driving or less', () => {
    expect(transitHours(0)).toBe(0);
    expect(transitHours(263)).toBe(driveHours(263));
    expect(transitHours(550)).toBe(11);
  });

  it('adds a 10 h break after every 11 h of driving', () => {
    expect(transitHours(551)).toBeCloseTo(driveHours(551) + 10, 10);
    expect(transitHours(664)).toBeCloseTo(13.28 + 10, 10);
    expect(transitHours(1_100)).toBe(22 + 10);
    expect(transitHours(1_101)).toBeCloseTo(driveHours(1_101) + 20, 10);
    // Houston -> Williston: about 31 h of driving, two breaks.
    expect(transitHours(1_572)).toBeCloseTo(31.44 + 20, 10);
  });

  it('never goes down for a longer run and treats negative miles as none', () => {
    let previous = 0;
    for (let miles = 0; miles <= 3_000; miles += 13) {
      expect(transitHours(miles)).toBeGreaterThanOrEqual(previous);
      previous = transitHours(miles);
    }
    expect(transitHours(-50)).toBe(0);
  });
});

describe('US states', () => {
  it('lists the 50 states plus DC with their names', () => {
    expect(STATE_CODES).toHaveLength(51);
    expect(US_STATES.TX).toBe('Texas');
    expect(US_STATES.DC).toBe('District of Columbia');
    expect(STATE_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(new Set(STATE_CODES).size).toBe(51);
  });

  it('recognises upper-case USPS codes only', () => {
    expect(isStateCode('TX')).toBe(true);
    expect(isStateCode('DC')).toBe(true);
    expect(isStateCode('tx')).toBe(false);
    expect(isStateCode('PR')).toBe(false);
    expect(isStateCode('ZZ')).toBe(false);
    expect(isStateCode('')).toBe(false);
  });

  it('does not mistake object built-ins for states', () => {
    expect(isStateCode('toString')).toBe(false);
    expect(isStateCode('constructor')).toBe(false);
    expect(isStateCode('__proto__')).toBe(false);
  });
});
