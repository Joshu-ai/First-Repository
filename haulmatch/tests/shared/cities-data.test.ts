import { describe, expect, it } from 'vitest';
import { CITIES, getCity, searchCities } from '../../shared/cities';
import baseCities from '../../shared/data/cities.json';
import extraCities from '../../shared/data/extra-cities.json';
import { haversineMiles, isStateCode, STATE_CODES } from '../../shared/geo';
import type { City } from '../../shared/types';

/** [south, north, west, east] extremes of each state in degrees. Alaska stops at the antimeridian. */
const STATE_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  AL: [30.14, 35.01, -88.48, -84.89],
  AK: [51.2, 71.44, -179.15, -129.97],
  AZ: [31.33, 37.0, -114.82, -109.04],
  AR: [33.0, 36.5, -94.62, -89.64],
  CA: [32.53, 42.01, -124.41, -114.13],
  CO: [36.99, 41.0, -109.06, -102.04],
  CT: [40.98, 42.05, -73.73, -71.79],
  DE: [38.45, 39.84, -75.79, -75.05],
  DC: [38.79, 39.0, -77.12, -76.91],
  FL: [24.52, 31.0, -87.63, -80.03],
  GA: [30.36, 35.0, -85.61, -80.84],
  HI: [18.91, 22.24, -160.25, -154.81],
  ID: [41.99, 49.0, -117.24, -111.04],
  IL: [36.97, 42.51, -91.51, -87.49],
  IN: [37.77, 41.76, -88.1, -84.78],
  IA: [40.38, 43.5, -96.64, -90.14],
  KS: [36.99, 40.0, -102.05, -94.59],
  KY: [36.5, 39.15, -89.57, -81.96],
  LA: [28.93, 33.02, -94.04, -88.82],
  ME: [43.06, 47.46, -71.08, -66.95],
  MD: [37.91, 39.72, -79.49, -75.05],
  MA: [41.24, 42.89, -73.51, -69.93],
  MI: [41.7, 48.31, -90.42, -82.12],
  MN: [43.5, 49.38, -97.24, -89.49],
  MS: [30.17, 35.0, -91.66, -88.1],
  MO: [35.99, 40.61, -95.77, -89.1],
  MT: [44.36, 49.0, -116.05, -104.04],
  NE: [40.0, 43.0, -104.05, -95.31],
  NV: [35.0, 42.0, -120.01, -114.04],
  NH: [42.7, 45.31, -72.56, -70.61],
  NJ: [38.93, 41.36, -75.56, -73.89],
  NM: [31.33, 37.0, -109.05, -103.0],
  NY: [40.5, 45.02, -79.76, -71.86],
  NC: [33.84, 36.59, -84.32, -75.46],
  ND: [45.94, 49.0, -104.05, -96.55],
  OH: [38.4, 41.98, -84.82, -80.52],
  OK: [33.62, 37.0, -103.0, -94.43],
  OR: [41.99, 46.29, -124.57, -116.46],
  PA: [39.72, 42.27, -80.52, -74.69],
  RI: [41.15, 42.02, -71.86, -71.12],
  SC: [32.03, 35.22, -83.35, -78.54],
  SD: [42.48, 45.95, -104.06, -96.44],
  TN: [34.98, 36.68, -90.31, -81.65],
  TX: [25.84, 36.5, -106.65, -93.51],
  UT: [37.0, 42.0, -114.05, -109.04],
  VT: [42.73, 45.02, -73.44, -71.46],
  VA: [36.54, 39.47, -83.68, -75.24],
  WA: [45.54, 49.0, -124.85, -116.92],
  WV: [37.2, 40.64, -82.64, -77.72],
  WI: [42.49, 47.31, -92.89, -86.25],
  WY: [40.99, 45.01, -111.06, -104.05],
};
/** Border towns sit right on the line, and the bounds above are rounded. */
const PAD_DEGREES = 0.1;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z]{2}$/;

const slug = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;
const key = (c: City): string => `${c.name}|${c.state}`;

function outsideState(city: City): boolean {
  const [south, north, west, east] = STATE_BOUNDS[city.state];
  return (
    city.lat < south - PAD_DEGREES ||
    city.lat > north + PAD_DEGREES ||
    city.lng < west - PAD_DEGREES ||
    city.lng > east + PAD_DEGREES
  );
}

const base = baseCities as City[];
const extra = extraCities as City[];

describe('city dataset', () => {
  it('has a bounding box for every state and DC', () => {
    expect(Object.keys(STATE_BOUNDS).sort()).toEqual([...STATE_CODES].sort());
  });

  it('gives every city a valid state code', () => {
    expect(CITIES.filter((c) => !isStateCode(c.state)).map((c) => c.id)).toEqual([]);
  });

  it('places every city inside its state', () => {
    expect(CITIES.filter(outsideState).map((c) => `${c.id} (${c.lat}, ${c.lng})`)).toEqual([]);
  });

  it('uses unique, well-formed ids that end in the state code', () => {
    const ids = CITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const malformed = CITIES.filter((c) => !ID_PATTERN.test(c.id) || !c.id.endsWith(`-${c.state.toLowerCase()}`));
    expect(malformed.map((c) => c.id)).toEqual([]);
  });

  it('has no duplicate name + state pairs', () => {
    const seen = new Set<string>();
    const dupes = CITIES.filter((c) => (seen.has(key(c)) ? true : (seen.add(key(c)), false)));
    expect(dupes.map(key)).toEqual([]);
  });

  it('has finite coordinates and positive whole populations', () => {
    const bad = CITIES.filter(
      (c) =>
        !Number.isFinite(c.lat) ||
        !Number.isFinite(c.lng) ||
        (c.population !== undefined && (!Number.isInteger(c.population) || c.population <= 0)),
    );
    expect(bad.map((c) => c.id)).toEqual([]);
  });
});

describe('freight hub towns (extra-cities.json)', () => {
  it('adds 60 to 120 towns that the base list does not have', () => {
    expect(extra.length).toBeGreaterThanOrEqual(60);
    expect(extra.length).toBeLessThanOrEqual(120);
    const baseIds = new Set(base.map((c) => c.id));
    const baseKeys = new Set(base.map(key));
    expect(extra.filter((c) => baseIds.has(c.id) || baseKeys.has(key(c))).map((c) => c.id)).toEqual([]);
  });

  it('derives ids from the name, keeps 4 decimals and records a population', () => {
    expect(extra.filter((c) => c.id !== `${slug(c.name)}-${c.state.toLowerCase()}`).map((c) => c.id)).toEqual([]);
    expect(extra.filter((c) => decimals(c.lat) > 4 || decimals(c.lng) > 4).map((c) => c.id)).toEqual([]);
    expect(extra.filter((c) => !c.population).map((c) => c.id)).toEqual([]);
  });

  it('covers the oilfield, ag, border and interstate hubs hotshots run', () => {
    const ids = new Set(extra.map((c) => c.id));
    const expected = [
      'pecos-tx', 'monahans-tx', 'carlsbad-nm', 'hobbs-nm', 'cotulla-tx', 'carrizo-springs-tx', 'williston-nd',
      'watford-city-nd', 'sidney-mt', 'elk-city-ok', 'woodward-ok', 'carthage-tx', 'houma-la', 'morgan-city-la',
      'gillette-wy', 'fort-morgan-co', 'dodge-city-ks', 'scottsbluff-ne', 'aberdeen-sd', 'eagle-pass-tx',
      'nogales-az', 'elko-nv', 'tucumcari-nm', 'kingman-az',
      // Permian, Bakken, Anadarko/SCOOP and Panhandle towns the demo's own basins run through.
      'jal-nm', 'denver-city-tx', 'crane-tx', 'stanton-tx', 'van-horn-tx', 'tioga-nd', 'stanley-nd', 'killdeer-nd',
      'kingfisher-ok', 'hennessey-ok', 'hereford-tx', 'dumas-tx', 'borger-tx', 'texarkana-ar',
    ];
    expect(expected.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('resolves every town by id and finds it by "Name, ST"', () => {
    expect(extra.filter((c) => getCity(c.id) !== c).map((c) => c.id)).toEqual([]);
    const missing = extra.filter((c) => !searchCities(`${c.name}, ${c.state}`, 25).some((hit) => hit.id === c.id));
    expect(missing.map((c) => c.id)).toEqual([]);
  });

  it('autocompletes the new towns from a partial name', () => {
    expect(searchCities('pecos')[0]?.id).toBe('pecos-tx');
    expect(searchCities('willist')[0]?.id).toBe('williston-nd');
    expect(searchCities('watford')[0]?.id).toBe('watford-city-nd');
    expect(searchCities('eagle pass')[0]?.id).toBe('eagle-pass-tx');
    expect(searchCities('houma, la')[0]?.id).toBe('houma-la');
    expect(searchCities('dodge')[0]?.id).toBe('dodge-city-ks');
    expect(searchCities('carlsbad nm').map((c) => c.id)).toEqual(['carlsbad-nm']);
    expect(searchCities('carlsbad').map((c) => c.id)).toEqual(['carlsbad-ca', 'carlsbad-nm']);
  });

  it('puts neighbouring towns the right distance apart', () => {
    const miles = (a: string, b: string) => haversineMiles(getCity(a)!, getCity(b)!);
    // Straight-line distances; the highways between them run a little longer.
    expect(miles('odessa-tx', 'pecos-tx')).toBeGreaterThan(65);
    expect(miles('odessa-tx', 'pecos-tx')).toBeLessThan(80);
    expect(miles('midland-tx', 'big-spring-tx')).toBeGreaterThan(32);
    expect(miles('midland-tx', 'big-spring-tx')).toBeLessThan(45);
    expect(miles('williston-nd', 'watford-city-nd')).toBeLessThan(40);
    expect(miles('houma-la', 'thibodaux-la')).toBeLessThan(20);
    // The basin towns added later, against neighbours already in the list.
    expect(miles('jal-nm', 'hobbs-nm')).toBeGreaterThan(30);
    expect(miles('jal-nm', 'hobbs-nm')).toBeLessThan(45);
    expect(miles('crane-tx', 'odessa-tx')).toBeLessThan(40);
    expect(miles('stanton-tx', 'midland-tx')).toBeLessThan(25);
    expect(miles('denver-city-tx', 'seminole-tx')).toBeLessThan(25);
    expect(miles('van-horn-tx', 'pecos-tx')).toBeGreaterThan(80);
    expect(miles('van-horn-tx', 'pecos-tx')).toBeLessThan(105);
    expect(miles('tioga-nd', 'williston-nd')).toBeLessThan(50);
    expect(miles('stanley-nd', 'tioga-nd')).toBeLessThan(40);
    expect(miles('killdeer-nd', 'dickinson-nd')).toBeLessThan(45);
    expect(miles('hennessey-ok', 'kingfisher-ok')).toBeLessThan(20);
    expect(miles('kingfisher-ok', 'el-reno-ok')).toBeLessThan(35);
    expect(miles('hereford-tx', 'amarillo-tx')).toBeLessThan(45);
    expect(miles('dumas-tx', 'amarillo-tx')).toBeLessThan(55);
    expect(miles('borger-tx', 'pampa-tx')).toBeLessThan(30);
    expect(miles('texarkana-ar', 'texarkana-tx')).toBeLessThan(5);
  });
});
