import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIGIN_RADIUS_MILES,
  equipmentCodeSchema,
  filtersSchema,
  isoDateSchema,
  loadPassesFilters,
  parseFilterQuery,
  stateCodeSchema,
} from '../../server/filters';
import { HttpError } from '../../server/http';
import { placeForCityId } from '../../shared/cities';
import { roadMiles } from '../../shared/geo';
import type { Load, LoadSearchFilters } from '../../shared/types';

const place = (id: string) => {
  const p = placeForCityId(id);
  if (!p) throw new Error(`unknown city ${id}`);
  return p;
};

/** An open Houston, TX -> Odessa, TX load picking up 08:00-16:00 UTC on Oct 19. */
function makeLoad(overrides: Partial<Load> = {}): Load {
  const origin = overrides.origin ?? place('houston-tx');
  const destination = overrides.destination ?? place('odessa-tx');
  const miles = roadMiles(origin, destination);
  const rateUsd = overrides.rateUsd ?? 1_400;
  return {
    id: 'load-1',
    shipperId: 'shipper-1',
    shipperName: 'Dana Ruiz',
    shipperCompany: 'Lone Star Oilfield Supply',
    status: 'open',
    origin,
    destination,
    pickupStart: '2026-10-19T08:00:00.000Z',
    pickupEnd: '2026-10-19T16:00:00.000Z',
    deliveryBy: null,
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 9_000,
    lengthFt: 30,
    commodity: 'Oilfield pipe',
    notes: 'Forklift on site. Call ahead.',
    loadSize: 'full',
    hazmat: false,
    tarpRequired: false,
    teamRequired: false,
    rateUsd,
    miles,
    ratePerMile: Math.round((rateUsd / miles) * 100) / 100,
    bookingMode: 'request',
    referenceNumber: 'PO-77812',
    bookedDriverId: null,
    bookedRateUsd: null,
    pendingRequestCount: 0,
    createdAt: '2026-10-18T12:00:00.000Z',
    updatedAt: '2026-10-18T12:00:00.000Z',
    pickedUpAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

function parseError(query: Record<string, unknown>): HttpError {
  try {
    parseFilterQuery(query);
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error(`expected ${JSON.stringify(query)} to be rejected`);
}

const passes = (filters: LoadSearchFilters, load = makeLoad()) => loadPassesFilters(load, filters);

describe('parseFilterQuery: coercion', () => {
  it('returns no filters for an empty query', () => {
    expect(parseFilterQuery({})).toEqual({});
  });

  it('coerces every filter from query-string text', () => {
    expect(
      parseFilterQuery({
        q: 'pipe',
        equipment: 'HS_GOOSENECK,FLATBED',
        originCityId: 'houston-tx',
        originRadiusMiles: '150',
        destinationStates: 'tx,ok',
        minRatePerMile: '2.25',
        maxWeightLbs: '10000',
        pickupFrom: '2026-10-19T00:00:00.000Z',
        pickupTo: '2026-10-21',
        hazmat: 'false',
        includeIneligible: '1',
        sort: 'rate',
      }),
    ).toEqual({
      q: 'pipe',
      equipment: ['HS_GOOSENECK', 'FLATBED'],
      originCityId: 'houston-tx',
      originRadiusMiles: 150,
      destinationStates: ['TX', 'OK'],
      minRatePerMile: 2.25,
      maxWeightLbs: 10_000,
      pickupFrom: '2026-10-19T00:00:00.000Z',
      pickupTo: '2026-10-21',
      hazmat: false,
      includeIneligible: true,
      sort: 'rate',
    });
  });

  it('trims list items and drops empty ones', () => {
    expect(parseFilterQuery({ equipment: ' HS_GOOSENECK , ,FLATBED, ' })).toEqual({ equipment: ['HS_GOOSENECK', 'FLATBED'] });
    expect(parseFilterQuery({ destinationStates: 'TX,' })).toEqual({ destinationStates: ['TX'] });
  });

  it('upper-cases state codes', () => {
    expect(parseFilterQuery({ destinationStates: 'tx, nM ,Ok' })).toEqual({ destinationStates: ['TX', 'NM', 'OK'] });
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads %s as %s', (raw, value) => {
    expect(parseFilterQuery({ hazmat: raw, includeIneligible: raw })).toEqual({ hazmat: value, includeIneligible: value });
  });

  it('trims the text search', () => {
    expect(parseFilterQuery({ q: '  steel coils ' })).toEqual({ q: 'steel coils' });
  });

  it('treats blank values as no filter', () => {
    expect(
      parseFilterQuery({
        q: '   ',
        equipment: '',
        originCityId: '',
        originRadiusMiles: ' ',
        destinationStates: ' ',
        minRatePerMile: '',
        maxWeightLbs: '',
        pickupFrom: '',
        pickupTo: '',
        hazmat: '',
        includeIneligible: '',
        sort: '',
      }),
    ).toEqual({});
  });

  it('treats a list of only commas as no filter', () => {
    const filters = parseFilterQuery({ equipment: ',', destinationStates: ' , ' });
    expect(filters).toEqual({});
    expect(loadPassesFilters(makeLoad(), filters)).toBe(true);
  });

  it('reads a repeated list param (parsed by Express as an array)', () => {
    expect(parseFilterQuery({ equipment: ['FLATBED', 'DRY_VAN,REEFER'] })).toEqual({ equipment: ['FLATBED', 'DRY_VAN', 'REEFER'] });
    expect(parseFilterQuery({ destinationStates: ['tx', 'ok'] })).toEqual({ destinationStates: ['TX', 'OK'] });
  });

  it('strips keys that are not filters, such as paging', () => {
    expect(parseFilterQuery({ limit: '10', offset: '20', driverId: 'x' })).toEqual({});
  });

  it('accepts every sort and the boundary values', () => {
    for (const sort of ['best', 'rate', 'deadhead', 'pickup', 'newest', 'profit']) expect(parseFilterQuery({ sort })).toEqual({ sort });
    expect(parseFilterQuery({ originRadiusMiles: '10', minRatePerMile: '0', maxWeightLbs: '1' })).toEqual({
      originRadiusMiles: 10,
      minRatePerMile: 0,
      maxWeightLbs: 1,
    });
    expect(parseFilterQuery({ originRadiusMiles: '1000', minRatePerMile: '20', maxWeightLbs: '200000' })).toEqual({
      originRadiusMiles: 1_000,
      minRatePerMile: 20,
      maxWeightLbs: 200_000,
    });
  });
});

describe('parseFilterQuery: validation', () => {
  it.each([
    ['an unknown equipment code', { equipment: 'FLATBED,SPACESHIP' }, 'equipment.1'],
    ['a lower-case equipment code', { equipment: 'flatbed' }, 'equipment.0'],
    ['an unknown state', { destinationStates: 'TX,ZZ' }, 'destinationStates.1'],
    ['an unknown origin city', { originCityId: 'nowhere-zz' }, 'originCityId'],
    ['a radius under 10 miles', { originRadiusMiles: '5' }, 'originRadiusMiles'],
    ['a radius over 1,000 miles', { originRadiusMiles: '1001' }, 'originRadiusMiles'],
    ['a fractional radius', { originRadiusMiles: '50.5' }, 'originRadiusMiles'],
    ['a radius that is not a number', { originRadiusMiles: 'far' }, 'originRadiusMiles'],
    ['a negative minimum rate', { minRatePerMile: '-1' }, 'minRatePerMile'],
    ['a minimum rate over $20/mi', { minRatePerMile: '21' }, 'minRatePerMile'],
    ['a minimum rate that is not a number', { minRatePerMile: 'abc' }, 'minRatePerMile'],
    ['a zero max weight', { maxWeightLbs: '0' }, 'maxWeightLbs'],
    ['a max weight over 200,000 lbs', { maxWeightLbs: '200001' }, 'maxWeightLbs'],
    ['a fractional max weight', { maxWeightLbs: '1.5' }, 'maxWeightLbs'],
    ['a pickupFrom that is not a date', { pickupFrom: 'tomorrow' }, 'pickupFrom'],
    ['a pickupTo that is not a date', { pickupTo: 'not-a-date' }, 'pickupTo'],
    ['an unknown sort', { sort: 'cheapest' }, 'sort'],
    ['a search over 80 characters', { q: 'x'.repeat(81) }, 'q'],
  ])('rejects %s with a 400', (_label, query, path) => {
    const err = parseError(query);
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
    expect(err.message.startsWith(`${path}: `)).toBe(true);
    expect(err.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it.each([['yes'], ['on'], ['maybe']])('rejects hazmat=%s instead of silently ignoring it', (raw) => {
    const err = parseError({ hazmat: raw, includeIneligible: raw });
    expect(err.status).toBe(400);
    expect((err.details as { path: string }[]).map((d) => d.path).sort()).toEqual(['hazmat', 'includeIneligible']);
  });

  it('reports every invalid field', () => {
    const err = parseError({ equipment: 'NOPE', sort: 'cheapest', minRatePerMile: '99' });
    expect((err.details as { path: string }[]).map((d) => d.path).sort()).toEqual(['equipment.0', 'minRatePerMile', 'sort']);
  });

  it('allows a search of exactly 80 characters', () => {
    expect(parseFilterQuery({ q: 'x'.repeat(80) })).toEqual({ q: 'x'.repeat(80) });
  });
});

describe('filtersSchema and building blocks', () => {
  it('validates saved-search JSON and strips unknown keys', () => {
    expect(filtersSchema.parse({ equipment: ['DRY_VAN'], minRatePerMile: 2, hazmat: true, extra: 'x' })).toEqual({
      equipment: ['DRY_VAN'],
      minRatePerMile: 2,
      hazmat: true,
    });
  });

  it('expects real JSON types, not query-string text', () => {
    expect(filtersSchema.safeParse({ minRatePerMile: '2' }).success).toBe(false);
    expect(filtersSchema.safeParse({ hazmat: 'true' }).success).toBe(false);
    expect(filtersSchema.safeParse({ equipment: 'DRY_VAN' }).success).toBe(false);
  });

  it('checks equipment codes, state codes and dates', () => {
    expect(equipmentCodeSchema.safeParse('HS_GOOSENECK').success).toBe(true);
    expect(equipmentCodeSchema.safeParse('GOOSENECK').success).toBe(false);
    expect(stateCodeSchema.safeParse('TX').success).toBe(true);
    expect(stateCodeSchema.safeParse('tx').success).toBe(false);
    expect(stateCodeSchema.safeParse('ZZ').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-10-19T08:00:00.000Z').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-10-19').success).toBe(true);
    expect(isoDateSchema.safeParse('next tuesday').success).toBe(false);
  });
});

describe('loadPassesFilters', () => {
  it('passes every load when there are no filters', () => {
    expect(passes({})).toBe(true);
    expect(passes({ equipment: [], destinationStates: [] })).toBe(true);
  });

  it('ignores the driver-side options', () => {
    expect(passes({ includeIneligible: false, sort: 'profit' })).toBe(true);
  });

  describe('text search', () => {
    it.each([
      ['commodity', 'PIPE'],
      ['notes', 'forklift'],
      ['reference number', 'po-778'],
      ['origin', 'Houston, TX'],
      ['origin without the comma', 'houston tx'],
      ['destination without the comma', 'Odessa TX'],
      ['destination', 'odessa'],
      ['shipper company', 'lone star'],
    ])('matches the %s case-insensitively', (_field, q) => {
      expect(passes({ q })).toBe(true);
    });

    it('falls back to the shipper name when there is no company', () => {
      expect(passes({ q: 'dana' }, makeLoad({ shipperCompany: null }))).toBe(true);
    });

    it('rejects a load that does not mention the search', () => {
      expect(passes({ q: 'lumber' })).toBe(false);
      expect(passes({ q: 'po-' }, makeLoad({ referenceNumber: null }))).toBe(false);
    });
  });

  it('keeps loads that accept any of the wanted equipment', () => {
    expect(passes({ equipment: ['FLATBED'] })).toBe(true);
    expect(passes({ equipment: ['DRY_VAN', 'HS_GOOSENECK'] })).toBe(true);
    expect(passes({ equipment: ['DRY_VAN', 'REEFER'] })).toBe(false);
  });

  describe('origin radius', () => {
    const beaumont = roadMiles(place('beaumont-tx'), place('houston-tx'));

    it('keeps pickups within the radius of the origin city', () => {
      expect(passes({ originCityId: 'houston-tx', originRadiusMiles: 10 })).toBe(true);
      expect(passes({ originCityId: 'beaumont-tx', originRadiusMiles: beaumont })).toBe(true);
      expect(passes({ originCityId: 'beaumont-tx', originRadiusMiles: beaumont - 1 })).toBe(false);
    });

    it('defaults the radius to 100 miles', () => {
      expect(DEFAULT_ORIGIN_RADIUS_MILES).toBe(100);
      expect(beaumont).toBeLessThanOrEqual(100);
      expect(passes({ originCityId: 'beaumont-tx' })).toBe(true);
      expect(roadMiles(place('lake-charles-la'), place('houston-tx'))).toBeGreaterThan(100);
      expect(passes({ originCityId: 'lake-charles-la' })).toBe(false);
    });

    it('ignores a radius without an origin city and an unknown city', () => {
      expect(passes({ originRadiusMiles: 10 })).toBe(true);
      expect(passes({ originCityId: 'nowhere-zz', originRadiusMiles: 10 })).toBe(true);
    });
  });

  it('keeps loads delivering to one of the wanted states', () => {
    expect(passes({ destinationStates: ['OK', 'TX'] })).toBe(true);
    expect(passes({ destinationStates: ['NM'] })).toBe(false);
    expect(passes({ destinationStates: ['TX'] }, makeLoad({ destination: place('shreveport-la') }))).toBe(false);
  });

  it('compares the minimum rate with the posted rate per mile', () => {
    const load = makeLoad();
    expect(passes({ minRatePerMile: load.ratePerMile }, load)).toBe(true);
    expect(passes({ minRatePerMile: load.ratePerMile - 0.01 }, load)).toBe(true);
    expect(passes({ minRatePerMile: load.ratePerMile + 0.01 }, load)).toBe(false);
    expect(passes({ minRatePerMile: 0 }, load)).toBe(true);
  });

  it('keeps loads at or under the max weight', () => {
    expect(passes({ maxWeightLbs: 9_000 })).toBe(true);
    expect(passes({ maxWeightLbs: 20_000 })).toBe(true);
    expect(passes({ maxWeightLbs: 8_999 })).toBe(false);
  });

  describe('pickup window', () => {
    // The load picks up 08:00-16:00 on Oct 19.
    it.each([
      ['a range covering the whole window', { pickupFrom: '2026-10-19T00:00:00.000Z', pickupTo: '2026-10-20T00:00:00.000Z' }, true],
      ['a range inside the window', { pickupFrom: '2026-10-19T10:00:00.000Z', pickupTo: '2026-10-19T12:00:00.000Z' }, true],
      ['a range overlapping the start', { pickupFrom: '2026-10-18T00:00:00.000Z', pickupTo: '2026-10-19T09:00:00.000Z' }, true],
      ['a range overlapping the end', { pickupFrom: '2026-10-19T15:00:00.000Z', pickupTo: '2026-10-22T00:00:00.000Z' }, true],
      ['a range ending as the window opens', { pickupTo: '2026-10-19T08:00:00.000Z' }, true],
      ['a range starting as the window closes', { pickupFrom: '2026-10-19T16:00:00.000Z' }, true],
      ['a range ending before the window opens', { pickupTo: '2026-10-19T07:59:00.000Z' }, false],
      ['a range starting after the window closes', { pickupFrom: '2026-10-19T16:01:00.000Z' }, false],
      ['a date-only pickupFrom on the pickup day', { pickupFrom: '2026-10-19' }, true],
      ['a date-only pickupTo the day before', { pickupTo: '2026-10-18' }, false],
    ])('handles %s', (_label, filters, expected) => {
      expect(passes(filters)).toBe(expected);
    });
  });

  it('filters hazmat loads both ways and keeps both when unset', () => {
    const hazmat = makeLoad({ hazmat: true });
    const plain = makeLoad({ hazmat: false });
    expect(passes({ hazmat: true }, hazmat)).toBe(true);
    expect(passes({ hazmat: true }, plain)).toBe(false);
    expect(passes({ hazmat: false }, hazmat)).toBe(false);
    expect(passes({ hazmat: false }, plain)).toBe(true);
    expect(passes({}, hazmat)).toBe(true);
    expect(passes({}, plain)).toBe(true);
  });

  it('requires every filter to pass', () => {
    const all: LoadSearchFilters = {
      q: 'pipe',
      equipment: ['HS_GOOSENECK'],
      originCityId: 'houston-tx',
      originRadiusMiles: 50,
      destinationStates: ['TX'],
      minRatePerMile: 2,
      maxWeightLbs: 10_000,
      pickupFrom: '2026-10-19T00:00:00.000Z',
      pickupTo: '2026-10-20T00:00:00.000Z',
      hazmat: false,
    };
    expect(passes(all)).toBe(true);
    expect(passes({ ...all, q: 'lumber' })).toBe(false);
    expect(passes({ ...all, equipment: ['DRY_VAN'] })).toBe(false);
    expect(passes({ ...all, originCityId: 'dallas-tx' })).toBe(false);
    expect(passes({ ...all, destinationStates: ['NM'] })).toBe(false);
    expect(passes({ ...all, minRatePerMile: 5 })).toBe(false);
    expect(passes({ ...all, maxWeightLbs: 5_000 })).toBe(false);
    expect(passes({ ...all, pickupFrom: '2026-10-20T00:00:00.000Z' })).toBe(false);
    expect(passes({ ...all, hazmat: true })).toBe(false);
  });
});
