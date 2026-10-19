import { describe, expect, it } from 'vitest';
import { ApiError } from '../../client/src/lib/api';
import { PICKUP_PASSED_LABEL, pickupWindowPassed } from '../../client/src/lib/loads';
import { tabCount } from '../../client/src/pages/shipper/components/dashboardTabs';
import {
  apiErrorsToFields,
  changesLaneOrSchedule,
  emptyLoadValues,
  hotshotFit,
  isOpenToHotshot,
  loadToValues,
  pickupWindowChanged,
  setOpenToHotshot,
  toLoadInput,
  toLoadUpdate,
  validateLoad,
} from '../../client/src/pages/shipper/components/loadForm';
import { acceptBlocker, shipperChecks } from '../../client/src/pages/shipper/components/shipperChecks';
import { placeForCityId } from '../../shared/cities';
import { matchLoad, type MatchableDriver } from '../../shared/matching';
import type { City, DriverSummary, Load, ShipperStats } from '../../shared/types';

const now = new Date('2026-10-18T15:00:00Z');
const houston: City = { id: 'houston-tx', name: 'Houston', state: 'TX', lat: 29.76, lng: -95.37 };
const odessa: City = { id: 'odessa-tx', name: 'Odessa', state: 'TX', lat: 31.85, lng: -102.37 };
const rules = { now, checkFuturePickup: true };

const filled = () => ({
  ...emptyLoadValues(now),
  origin: houston,
  destination: odessa,
  commodity: ' Pipe ',
  weightLbs: 9200,
  lengthFt: 32,
  equipmentTypes: ['HS_GOOSENECK' as const],
  rateUsd: 950,
});

const posted: Load = {
  id: 'l1',
  shipperId: 's',
  shipperName: 'S',
  shipperCompany: null,
  status: 'open',
  origin: placeForCityId('houston-tx')!,
  destination: placeForCityId('odessa-tx')!,
  pickupStart: '2026-10-19T13:00:00.000Z',
  pickupEnd: '2026-10-19T17:00:00.000Z',
  deliveryBy: '2026-10-20T13:00:00.000Z',
  equipmentTypes: ['FLATBED', 'HS_GOOSENECK'],
  weightLbs: 9200,
  lengthFt: 32,
  commodity: 'Pipe',
  notes: '',
  loadSize: 'full',
  hazmat: false,
  tarpRequired: false,
  teamRequired: false,
  rateUsd: 950,
  miles: 514,
  ratePerMile: 1.85,
  bookingMode: 'request',
  referenceNumber: 'PO-1',
  bookedDriverId: null,
  bookedRateUsd: null,
  pendingRequestCount: 0,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  pickedUpAt: null,
  deliveredAt: null,
};

describe('post load form', () => {
  it('flags every required field on an empty form', () => {
    expect(Object.keys(validateLoad(emptyLoadValues(now), rules)).sort()).toEqual(
      ['commodity', 'destination', 'equipmentTypes', 'lengthFt', 'origin', 'rateUsd', 'weightLbs'].sort(),
    );
  });

  it('mirrors the server rules', () => {
    const ok = filled();
    expect(validateLoad(ok, rules)).toEqual({});
    expect(validateLoad({ ...ok, destination: houston }, rules).destination).toBe('Delivery must be in a different city than pickup');
    const past = { ...ok, pickupStart: '2026-10-18T09:00:00Z', pickupEnd: '2026-10-18T10:00:00Z' };
    expect(validateLoad(past, rules).pickupEnd).toBe('Pickup window must end in the future');
    expect(validateLoad(past, { now, checkFuturePickup: false }).pickupEnd).toBeUndefined();
    expect(validateLoad({ ...ok, rateUsd: 49 }, rules).rateUsd).toBeTruthy();
    expect(validateLoad({ ...ok, rateUsd: 99.5 }, rules).rateUsd).toBeTruthy();
    expect(validateLoad({ ...ok, deliveryBy: '2026-10-18T00:00:00Z' }, rules).deliveryBy).toBeTruthy();
  });

  it('builds a clean POST body', () => {
    const input = toLoadInput(filled());
    expect(input.commodity).toBe('Pipe');
    expect(input.referenceNumber).toBeUndefined();
    expect(input.deliveryBy).toBeUndefined();
  });

  it('opens a load to hotshots and judges whether a typical hotshot fits', () => {
    expect(setOpenToHotshot(['FLATBED'], true)).toEqual(['FLATBED', 'HS_GOOSENECK', 'HS_DOVETAIL']);
    expect(setOpenToHotshot(['FLATBED', 'HS_GOOSENECK', 'HS_BUMPER_PULL'], false)).toEqual(['FLATBED']);
    expect(isOpenToHotshot(['HS_CAR_HAULER'])).toBe(true);
    expect(hotshotFit(16_500, 40).fits).toBe(true);
    expect(hotshotFit(16_501, 40).fits).toBe(false);
    expect(hotshotFit(9_000, 40.5).fits).toBe(false);
    expect(hotshotFit(12_000, 30).needsCdl).toBe(true);
    expect(hotshotFit(null, null).known).toBe(false);
  });

  it('sends only what changed on edit and clears with null', () => {
    const values = loadToValues(posted, 'edit', now);
    expect(toLoadUpdate({ ...values, equipmentTypes: ['HS_GOOSENECK', 'FLATBED'] }, posted)).toEqual({});
    expect(pickupWindowChanged(values, posted)).toBe(false);
    expect(toLoadUpdate({ ...values, deliveryBy: null, referenceNumber: '  ', rateUsd: 1000 }, posted)).toEqual({
      deliveryBy: null,
      referenceNumber: null,
      rateUsd: 1000,
    });
  });

  it('knows which edits cancel the waiting requests: a new lane, pickup window or delivery deadline', () => {
    // PATCH /api/loads/:id cancels pending requests on exactly these changes, so the form warns first.
    const values = loadToValues(posted, 'edit', now);
    expect(changesLaneOrSchedule(values, posted)).toBe(false);
    expect(changesLaneOrSchedule({ ...values, rateUsd: 900, commodity: 'Casing', weightLbs: 8000 }, posted)).toBe(false);
    // The same instant written another way is not a change.
    expect(changesLaneOrSchedule({ ...values, pickupStart: '2026-10-19T08:00:00-05:00' }, posted)).toBe(false);

    expect(changesLaneOrSchedule({ ...values, origin: odessa, destination: houston }, posted)).toBe(true);
    expect(changesLaneOrSchedule({ ...values, destination: { ...houston, id: 'midland-tx' } }, posted)).toBe(true);
    expect(changesLaneOrSchedule({ ...values, pickupEnd: '2026-10-19T19:00:00.000Z' }, posted)).toBe(true);
    expect(changesLaneOrSchedule({ ...values, deliveryBy: null }, posted)).toBe(true);
    // Half-filled while typing: a cleared city counts, and nothing throws.
    expect(changesLaneOrSchedule({ ...values, origin: null }, posted)).toBe(true);
  });

  it('reposts with fresh dates and the same reference', () => {
    const repost = loadToValues(posted, 'repost', now);
    expect(repost.pickupStart).not.toBe(posted.pickupStart);
    expect(repost.deliveryBy).toBeNull();
    expect(repost.referenceNumber).toBe('PO-1');
  });

  it('puts server field errors on the matching form fields', () => {
    const err = new ApiError(400, 'validation_error', 'x', [
      { path: 'destinationCityId', message: 'Different city' },
      { path: 'equipmentTypes.0', message: 'Bad code' },
    ]);
    expect(apiErrorsToFields(err)).toEqual({ destination: 'Different city', equipmentTypes: 'Bad code' });
  });
});

describe('shipperChecks', () => {
  const summary: DriverSummary = {
    userId: 'd',
    name: 'D',
    company: null,
    phone: null,
    driverClass: 'hotshot',
    equipmentTypes: ['HS_GOOSENECK'],
    trailerLengthFt: 40,
    maxPayloadLbs: 10000,
    truckDescription: '',
    hasCdl: false,
    endorsements: [],
    mcNumber: null,
    dotNumber: null,
    rating: 0,
    completedLoads: 0,
    currentLocation: null,
    available: true,
  };
  const profile: MatchableDriver = {
    ...summary,
    teamDriver: false,
    homeBase: null,
    availableFrom: null,
    maxDeadheadMiles: 150,
    minRatePerMile: 1.5,
    preferredStates: [],
    avoidStates: [],
    mpg: 11,
    fuelPricePerGallon: 3.75,
  };

  it('rewords every check about the driver instead of "you"', () => {
    const match = matchLoad(posted, profile, { now, ignoreDeadheadLimit: true });
    const labels = shipperChecks(posted, summary, match).map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Gooseneck matches your load',
        '9,200 lbs of their 10,000 lbs capacity',
        '32 ft fits their 40 ft deck',
        'Location not set',
      ]),
    );
    expect(labels.some((l) => /\byour (rig|gooseneck|deck|capacity)\b|\bYou\b/.test(l))).toBe(false);
  });

  it('says a Class A CDL is missing when the load is too heavy for a non-CDL rig', () => {
    const heavy = { ...posted, weightLbs: 12_000 };
    const match = matchLoad(heavy, { ...profile, maxPayloadLbs: 16_500 }, { now, ignoreDeadheadLimit: true });
    const cdl = shipperChecks(heavy, summary, match).find((c) => c.key === 'cdl');
    expect(cdl).toMatchObject({ ok: false, label: 'No Class A CDL for this weight or trailer' });
  });
});

describe('requests a shipper can no longer accept', () => {
  const driver: MatchableDriver = {
    driverClass: 'hotshot',
    equipmentTypes: ['HS_GOOSENECK'],
    trailerLengthFt: 40,
    maxPayloadLbs: 10000,
    hasCdl: false,
    endorsements: [],
    teamDriver: false,
    currentLocation: null,
    homeBase: null,
    availableFrom: null,
    maxDeadheadMiles: 150,
    minRatePerMile: 1.5,
    preferredStates: [],
    avoidStates: [],
    mpg: 11,
    fuelPricePerGallon: 3.75,
  };
  const fit = matchLoad(posted, driver, { now, ignoreDeadheadLimit: true });

  it('blocks Accept on a pending request that no longer fits, or has no rig to check', () => {
    // POST /bookings/:id/accept re-runs the booking checks and answers 422 for these.
    expect(fit.eligible).toBe(true);
    expect(acceptBlocker({ status: 'pending', match: fit })).toBeNull();
    expect(acceptBlocker({ status: 'pending', match: { ...fit, eligible: false } })).toBe('Doesn’t fit this load as it is now');
    expect(acceptBlocker({ status: 'pending', match: null })).toBe('Can’t be booked until their rig profile is finished');
    // Settled requests have no Accept button to block.
    expect(acceptBlocker({ status: 'declined', match: { ...fit, eligible: false } })).toBeNull();
  });
});

describe('open loads past their pickup window', () => {
  it('counts as passed only while still open after pickup closes', () => {
    const late = new Date('2026-10-19T17:00:01Z');
    expect(pickupWindowPassed(posted, now)).toBe(false);
    expect(pickupWindowPassed(posted, new Date('2026-10-19T17:00:00Z'))).toBe(false);
    expect(pickupWindowPassed(posted, late)).toBe(true);
    expect(pickupWindowPassed({ ...posted, status: 'booked' }, late)).toBe(false);
    expect(PICKUP_PASSED_LABEL).toBe('Pickup window passed: edit or cancel');
  });

  it('adds expired loads back into the Open and Active tab counts, which still list them', () => {
    // ShipperStats.open leaves out loads past their pickup window (they are `expired`), but
    // /shipper/loads?status=open and ?status=active still return them.
    const stats: ShipperStats = {
      open: 3,
      expired: 2,
      booked: 4,
      inTransit: 1,
      delivered: 9,
      cancelled: 5,
      pendingRequests: 0,
    };
    expect(tabCount('open', stats)).toBe(5);
    expect(tabCount('active', stats)).toBe(10);
    expect(tabCount('booked', stats)).toBe(4);
    expect(tabCount('in_transit', stats)).toBe(1);
    expect(tabCount('delivered', stats)).toBe(9);
    expect(tabCount('cancelled', stats)).toBe(5);
    expect(tabCount('open', undefined)).toBeUndefined();
  });
});
