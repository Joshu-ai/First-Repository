import { describe, expect, it } from 'vitest';
import { ApiError } from '../../client/src/lib/api';
import {
  draftFromFilters,
  emptyDraft,
  filterChips,
  filterErrorsFromPaths,
  filtersForAlert,
  filtersFromDraft,
  validateFilterDraft,
} from '../../client/src/pages/driver/components/filterDraft';
import {
  changeDriverClass,
  cleanAuthorityNumber,
  draftFromProfile,
  errorsFromApi,
  firstSectionWithError,
  fullUpdate,
  sameDraft,
  sectionUpdate,
  suggestCapacity,
  validateAll,
  validateSection,
} from '../../client/src/pages/driver/components/profileForm';
import type { DriverProfile, LoadSearchFilters } from '../../shared/types';

const now = new Date('2026-10-18T12:00:00Z');

/** A freshly registered hotshot: class defaults, no equipment, no location. */
const newHotshot: DriverProfile = {
  userId: 'u1',
  driverClass: 'hotshot',
  equipmentTypes: [],
  trailerLengthFt: 40,
  maxPayloadLbs: 10000,
  truckDescription: '',
  mcNumber: null,
  dotNumber: null,
  hasCdl: false,
  cdlClass: null,
  endorsements: [],
  teamDriver: false,
  currentLocation: null,
  homeBase: null,
  available: true,
  availableFrom: null,
  maxDeadheadMiles: 150,
  minRatePerMile: 1.5,
  preferredStates: [],
  avoidStates: [],
  mpg: 11,
  fuelPricePerGallon: 3.75,
  rating: 0,
  completedLoads: 0,
  profileComplete: false,
  updatedAt: now.toISOString(),
};
const d = draftFromProfile(newHotshot, now);

describe('profile form (setup wizard and rig profile)', () => {
  it('requires at least one trailer', () => {
    expect(validateSection('equipment', d).equipmentTypes).toBe('Pick at least one trailer you can pull');
  });

  it('prefills capacity from the equipment and holds a non-CDL rig to 10,000 lbs', () => {
    const nonCdl = suggestCapacity({ ...d, equipmentTypes: ['HS_GOOSENECK'] })!;
    expect([nonCdl.trailerLengthFt, nonCdl.maxPayloadLbs, nonCdl.cappedForNonCdl]).toEqual([40, 10000, true]);
    expect(suggestCapacity({ ...d, hasCdl: true, equipmentTypes: ['HS_GOOSENECK'] })!.maxPayloadLbs).toBe(16500);
  });

  it('swaps class defaults on a class switch but keeps values the driver typed', () => {
    const semi = changeDriverClass({ ...d, equipmentTypes: ['HS_GOOSENECK'] }, 'semi');
    expect([semi.equipmentTypes, semi.trailerLengthFt, semi.maxPayloadLbs, semi.hasCdl, semi.cdlClass, semi.mpg, semi.maxDeadheadMiles]).toEqual(
      [[], 53, 45000, true, 'A', 6.5, 200],
    );
    const custom = changeDriverClass({ ...d, trailerLengthFt: 32, mpg: 12 }, 'semi');
    expect([custom.trailerLengthFt, custom.mpg]).toEqual([32, 12]);
  });

  it('cleans MC and DOT numbers and rejects junk', () => {
    expect(cleanAuthorityNumber('MC-1184520')).toBe('1184520');
    expect(cleanAuthorityNumber('USDOT # 33 658 71')).toBe('3365871');
    const update = sectionUpdate('capacity', { ...d, mcNumber: 'MC 123', dotNumber: '' });
    expect([update.mcNumber, update.dotNumber]).toEqual(['123', null]);
    expect(validateSection('capacity', { ...d, mcNumber: 'abc' }).mcNumber).toBeTruthy();
  });

  it('drops CDL-only endorsements without a CDL but keeps TWIC', () => {
    expect(sectionUpdate('capacity', { ...d, endorsements: ['hazmat', 'twic'] }).endorsements).toEqual(['twic']);
  });

  it('needs a location and a future availability date', () => {
    expect(validateSection('location', d, now).currentCityId).toBeTruthy();
    const later = validateSection('location', { ...d, availability: 'later', availableFrom: '2026-10-17T00:00:00Z' }, now);
    expect(later.availableFrom).toBeTruthy();
    const off = sectionUpdate('location', { ...d, availability: 'off', availableFrom: '2026-10-20T00:00:00Z' });
    expect([off.available, off.availableFrom]).toEqual([false, null]);
  });

  it('range-checks preferences like the API does', () => {
    const errors = validateAll({ ...d, maxDeadheadMiles: 2000, mpg: 1, fuelPricePerGallon: null }, now);
    expect(errors.maxDeadheadMiles && errors.mpg && errors.fuelPricePerGallon).toBeTruthy();
  });

  it('compares drafts ignoring equipment order and sends every field on a full save', () => {
    expect(sameDraft({ ...d, equipmentTypes: ['HS_GOOSENECK', 'HS_DOVETAIL'] }, { ...d, equipmentTypes: ['HS_DOVETAIL', 'HS_GOOSENECK'] })).toBe(true);
    expect(Object.keys(fullUpdate(d))).toHaveLength(21);
  });

  it('maps API field errors to fields and the wizard step that owns them', () => {
    const err = new ApiError(400, 'validation_error', 'x', [
      { path: 'preferredStates.1', message: 'Unknown state code' },
      { path: 'currentCityId', message: 'Unknown city' },
    ]);
    const errors = errorsFromApi(err);
    expect(errors.preferredStates).toBe('Unknown state code');
    expect(firstSectionWithError(errors)).toBe('location');
  });
});

describe('filter drafts (board filters and alerts)', () => {
  it('round-trips filters through the editor', () => {
    const filters: LoadSearchFilters = {
      equipment: ['HS_GOOSENECK'],
      originCityId: 'odessa-tx',
      originRadiusMiles: 150,
      destinationStates: ['TX', 'NM'],
      minRatePerMile: 2,
      hazmat: false,
      sort: 'rate',
    };
    const draft = draftFromFilters(filters, { id: 'odessa-tx', name: 'Odessa', state: 'TX', lat: 31.8, lng: -102.3 });
    expect(filtersFromDraft(draft, { sort: filters.sort })).toEqual({ ...filters, destinationStates: ['NM', 'TX'] });
  });

  it('turns picked dates into whole local days', () => {
    const f = filtersFromDraft({ ...emptyDraft(), pickupFrom: '2026-10-20', pickupTo: '2026-10-21' });
    expect(new Date(f.pickupTo!).getTime() - new Date(f.pickupFrom!).getTime()).toBeGreaterThan(47 * 3_600_000);
  });

  it('validates ranges and date order', () => {
    const errors = validateFilterDraft({ ...emptyDraft(), minRatePerMile: 25, maxWeightLbs: 0, pickupFrom: '2026-10-21', pickupTo: '2026-10-20' });
    expect(errors.minRatePerMile && errors.maxWeightLbs && errors.pickupTo).toBeTruthy();
  });

  it('makes one removable chip per filter', () => {
    const f: LoadSearchFilters = { originCityId: 'odessa-tx', minRatePerMile: 2, includeIneligible: true };
    const chips = filterChips(f, null, now);
    expect(chips.map((c) => c.label)).toEqual(['Within 100 mi of Odessa, TX', '$2.00+/mi', 'Incl. loads you can’t take']);
    expect(chips[0].without(f)).toEqual({ minRatePerMile: 2, includeIneligible: true });
  });

  it('never saves "loads I can’t take" into an alert and maps saved-search error paths', () => {
    expect(filtersForAlert({ includeIneligible: true, minRatePerMile: 2 })).toEqual({ minRatePerMile: 2 });
    expect(filterErrorsFromPaths({ 'filters.originCityId': 'Unknown city' })).toEqual({ originCity: 'Unknown city' });
  });
});
