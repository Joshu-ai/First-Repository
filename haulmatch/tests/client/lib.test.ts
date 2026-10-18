import { describe, expect, it } from 'vitest';
import { isoToLocalInput, localInputToIso } from '../../client/src/components/DateTimeInput';
import { ApiError } from '../../client/src/lib/api';
import {
  activeFilterCount,
  cityIdToLabel,
  describeFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
} from '../../client/src/lib/filters';
import * as f from '../../client/src/lib/format';
import { allowedBeforeSetup, homePathFor, paths, safeNextPath } from '../../client/src/lib/routes';
import type { LoadSearchFilters } from '../../shared/types';

// Dates below are built from local wall-clock strings, so the assertions hold in any time zone.
const now = new Date('2026-10-18T12:00:00'); // a Sunday, local noon
const local = (s: string) => new Date(s);

describe('format: money and units', () => {
  it('formats dollars, $/mi, miles, pounds and feet', () => {
    expect(f.money(1400)).toBe('$1,400');
    expect(f.money(-120)).toBe('-$120');
    expect(f.money(3.75, { cents: true })).toBe('$3.75');
    expect(f.ratePerMile(2.66)).toBe('$2.66/mi');
    expect(f.ratePerMile(2.6)).toBe('$2.60/mi');
    expect(f.miles(1234)).toBe('1,234 mi');
    expect(f.lbs(10000)).toBe('10,000 lbs');
    expect(f.feet(40)).toBe('40 ft');
  });

  it('formats places and lanes from both Place and City shapes', () => {
    const odessa = { cityId: 'odessa-tx', city: 'Odessa', state: 'TX', lat: 0, lng: 0 };
    const houston = { id: 'houston-tx', name: 'Houston', state: 'TX', lat: 0, lng: 0 };
    expect(f.place(odessa)).toBe('Odessa, TX');
    expect(f.place(houston)).toBe('Houston, TX');
    expect(f.place(null)).toBe('—');
    expect(f.lane(houston, odessa)).toBe('Houston, TX → Odessa, TX');
  });
});

describe('format: times', () => {
  it('names pickup days the way a driver says them', () => {
    expect(f.pickupTime(local('2026-10-18T14:00:00'), now)).toBe('Today 2:00 PM');
    expect(f.pickupTime(local('2026-10-19T08:00:00'), now)).toBe('Tomorrow 8:00 AM');
    expect(f.pickupTime(local('2026-10-21T08:00:00'), now)).toBe('Wed, Oct 21 8:00 AM');
    expect(f.pickupTime(local('2026-10-17T15:00:00'), now)).toBe('Yesterday 3:00 PM');
    expect(f.pickupTime(local('2027-01-05T08:00:00'), now)).toBe('Tue, Jan 5, 2027 8:00 AM');
  });

  it('formats pickup windows', () => {
    expect(f.timeWindow(local('2026-10-18T14:00:00'), local('2026-10-18T18:00:00'), now)).toBe('Today 2:00 PM – 6:00 PM');
    expect(f.timeWindow(local('2026-10-18T14:00:00'), local('2026-10-19T08:00:00'), now)).toBe(
      'Today 2:00 PM – Tomorrow 8:00 AM',
    );
    expect(f.timeWindow(local('2026-10-18T14:00:00'), null, now)).toBe('Today 2:00 PM');
  });

  it('formats relative times', () => {
    expect(f.timeAgo(local('2026-10-18T11:59:40'), now)).toBe('just now');
    expect(f.timeAgo(local('2026-10-18T11:55:00'), now)).toBe('5m ago');
    expect(f.timeAgo(local('2026-10-18T09:00:00'), now)).toBe('3h ago');
    expect(f.timeAgo(local('2026-10-16T12:00:00'), now)).toBe('2d ago');
    expect(f.timeAgo(local('2026-10-03T12:00:00'), now)).toBe('Oct 3');
    expect(f.timeAgo(local('2026-10-18T15:00:00'), now)).toBe('in 3h');
    expect(f.relativeHours(local('2026-10-18T15:00:00'), now)).toBe('in 3h');
    expect(f.relativeHours(local('2026-10-21T12:00:00'), now)).toBe('in 3d');
  });
});

describe('format: labels', () => {
  it('labels equipment, scores, counts, initials and statuses', () => {
    expect(f.equipmentLabel('HS_GOOSENECK')).toBe('Hotshot gooseneck flatbed');
    expect(f.equipmentList(['HS_GOOSENECK', 'FLATBED'])).toBe('Gooseneck, Flatbed');
    expect(f.scoreLabel(92)).toBe('Great match');
    expect(f.scoreLabel(70)).toBe('Good match');
    expect(f.scoreLabel(50)).toBe('Fair match');
    expect(f.scoreLabel(49)).toBe('Weak match');
    expect(f.scoreLabel(80, false)).toBe('Not a fit');
    expect(f.plural(1, 'request')).toBe('1 request');
    expect(f.plural(3, 'request')).toBe('3 requests');
    expect(f.initials('Jess  Ortiz')).toBe('JO');
    expect(f.initials('Cher')).toBe('C');
    expect(f.loadStatusLabel('in_transit')).toBe('In transit');
  });
});

describe('filters: URL and API query format', () => {
  const filters: LoadSearchFilters = {
    q: 'pipe',
    equipment: ['HS_GOOSENECK', 'FLATBED'],
    originCityId: 'odessa-tx',
    originRadiusMiles: 150,
    destinationStates: ['TX', 'NM'],
    minRatePerMile: 2,
    maxWeightLbs: 10000,
    hazmat: false,
    includeIneligible: true,
    sort: 'profit',
  };

  it('round-trips through query strings the server parses', () => {
    const qs = filtersToSearchParams(filters).toString();
    expect(qs).toBe(
      'q=pipe&equipment=HS_GOOSENECK%2CFLATBED&originCityId=odessa-tx&originRadiusMiles=150&destinationStates=TX%2CNM' +
        '&minRatePerMile=2&maxWeightLbs=10000&hazmat=false&includeIneligible=true&sort=profit',
    );
    expect(filtersFromSearchParams(new URLSearchParams(qs))).toEqual(filters);
    expect(filtersToSearchParams({}).toString()).toBe('');
  });

  it('drops values a hand-edited URL gets wrong', () => {
    const parsed = filtersFromSearchParams(new URLSearchParams('equipment=NOPE,REEFER&destinationStates=tx,ZZ&sort=bogus&hazmat=1'));
    expect(parsed).toEqual({ equipment: ['REEFER'], destinationStates: ['TX'], hazmat: true });
  });

  it('counts and describes active filters', () => {
    expect(activeFilterCount(filters)).toBe(7);
    expect(cityIdToLabel('oklahoma-city-ok')).toBe('Oklahoma City, OK');
    expect(
      describeFilters({ equipment: ['HS_GOOSENECK'], originCityId: 'odessa-tx', destinationStates: ['TX'], minRatePerMile: 2 }),
    ).toBe('Gooseneck · within 100 mi of Odessa, TX · to TX · $2.00+/mi');
    expect(describeFilters({})).toBe('Any load that fits your rig');
  });
});

describe('routes', () => {
  it('sends each role home, drivers to setup until their rig is complete', () => {
    expect(homePathFor({ role: 'shipper' }, null)).toBe('/shipper');
    expect(homePathFor({ role: 'driver' }, { profileComplete: false })).toBe('/driver/setup');
    expect(homePathFor({ role: 'driver' }, { profileComplete: true })).toBe('/driver/loads');
  });

  it('only follows ?next= inside the app', () => {
    expect(safeNextPath('/driver/loads/abc?x=1')).toBe('/driver/loads/abc?x=1');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('/login?next=/x')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });

  it('lets an unfinished driver reach messages, notifications and account only', () => {
    expect(allowedBeforeSetup('/messages/l1/d1')).toBe(true);
    expect(allowedBeforeSetup('/account')).toBe(true);
    expect(allowedBeforeSetup('/driver/loads')).toBe(false);
    expect(allowedBeforeSetup('/messagesx')).toBe(false);
  });

  it('builds encoded paths', () => {
    expect(paths.login('/driver/loads?sort=rate')).toBe('/login?next=%2Fdriver%2Floads%3Fsort%3Drate');
    expect(paths.signup('driver', 'semi')).toBe('/signup?role=driver&class=semi');
    expect(paths.signup('shipper', 'semi')).toBe('/signup?role=shipper');
    expect(paths.thread('l 1', 'd1')).toBe('/messages/l%201/d1');
  });
});

describe('datetime-local helpers', () => {
  it('converts between ISO and the input format in local time', () => {
    expect(isoToLocalInput(local('2026-10-19T08:05:00').toISOString())).toBe('2026-10-19T08:05');
    expect(localInputToIso('2026-10-19T08:05')).toBe(local('2026-10-19T08:05:00').toISOString());
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput('garbage')).toBe('');
  });
});

describe('ApiError.fieldErrors', () => {
  it('keeps the first message per field and maps field-specific codes', () => {
    const err = new ApiError(400, 'validation_error', 'email: Invalid', [
      { path: 'email', message: 'Invalid email' },
      { path: 'email', message: 'second' },
      { path: '', message: 'root' },
    ]);
    expect(err.fieldErrors()).toEqual({ email: 'Invalid email' });
    expect(new ApiError(409, 'email_taken', 'That email is already registered').fieldErrors()).toEqual({
      email: 'That email is already registered',
    });
    expect(new ApiError(500, 'internal', 'x').fieldErrors()).toEqual({});
  });
});
