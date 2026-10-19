// The illustrative load on the landing page. Its match comes from the real matching engine, with a
// driver on the class defaults (MARKET_SNAPSHOT diesel included), so the card never shows numbers
// the app itself would not.
import { DEFAULT_FUEL_PRICE_PER_GALLON, DRIVER_CLASSES } from '../../../../shared/equipment';
import { roadMiles } from '../../../../shared/geo';
import { matchLoad, type MatchableDriver } from '../../../../shared/matching';
import { estimateRate } from '../../../../shared/rates';
import type { EquipmentCode, LoadWithMatch, MatchCheck, Place } from '../../../../shared/types';

const HOUR_MS = 3_600_000;

const HOUSTON: Place = { cityId: 'houston-tx', city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 };
const ODESSA: Place = { cityId: 'odessa-tx', city: 'Odessa', state: 'TX', lat: 31.8457, lng: -102.3676 };
/** Where the example driver sits empty: a short deadhead from the Houston pickup. */
const PASADENA: Place = { cityId: 'pasadena-tx', city: 'Pasadena', state: 'TX', lat: 29.6911, lng: -95.2091 };

const EQUIPMENT_TYPES: EquipmentCode[] = ['HS_GOOSENECK', 'FLATBED'];
const WEIGHT_LBS = 9_200;
const LENGTH_FT = 32;
/** The example pays this share of the market for the driver's whole run, so "Pays above market" is true. */
export const EXAMPLE_MARKET_SHARE = 1.2;

/** A non-CDL gooseneck hotshot on the hotshot defaults (mpg, minimum $/mi, diesel price). */
export const EXAMPLE_DRIVER: MatchableDriver = {
  driverClass: 'hotshot',
  equipmentTypes: ['HS_GOOSENECK'],
  trailerLengthFt: 40,
  maxPayloadLbs: 10_000,
  hasCdl: false,
  endorsements: [],
  teamDriver: false,
  currentLocation: PASADENA,
  homeBase: null,
  availableFrom: null,
  maxDeadheadMiles: DRIVER_CLASSES.hotshot.defaultMaxDeadheadMiles,
  minRatePerMile: DRIVER_CLASSES.hotshot.defaultMinRatePerMile,
  preferredStates: ['TX'],
  avoidStates: [],
  mpg: DRIVER_CLASSES.hotshot.defaultMpg,
  fuelPricePerGallon: DEFAULT_FUEL_PRICE_PER_GALLON,
};

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Houston, TX -> Odessa, TX picking up tomorrow at 8 AM local time (so the time label reads
 * naturally), priced at EXAMPLE_MARKET_SHARE of the lane market and matched for EXAMPLE_DRIVER,
 * who is free two hours before pickup opens (so the score does not drift with the time of day).
 */
export function exampleLoad(now: Date): LoadWithMatch {
  const pickup = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0);
  const pickupEnd = new Date(pickup.getTime() + 4 * HOUR_MS);
  const miles = roadMiles(HOUSTON, ODESSA);
  const deadhead = roadMiles(PASADENA, HOUSTON);
  const freight = { weightLbs: WEIGHT_LBS, lengthFt: LENGTH_FT };
  const market = estimateRate(miles + deadhead, EXAMPLE_DRIVER.equipmentTypes, freight).suggestedUsd;
  const rateUsd = roundTo(market * EXAMPLE_MARKET_SHARE, 25);
  const iso = (d: Date) => d.toISOString();
  const load: Omit<LoadWithMatch, 'match'> = {
    id: 'example',
    shipperId: 'example',
    shipperName: 'Example shipper',
    shipperCompany: 'Example shipper',
    status: 'open',
    origin: HOUSTON,
    destination: ODESSA,
    pickupStart: iso(pickup),
    pickupEnd: iso(pickupEnd),
    deliveryBy: null,
    equipmentTypes: EQUIPMENT_TYPES,
    ...freight,
    commodity: 'Oilfield pipe',
    notes: '',
    loadSize: 'full',
    hazmat: false,
    tarpRequired: false,
    teamRequired: false,
    rateUsd,
    miles,
    ratePerMile: Math.round((rateUsd / miles) * 100) / 100,
    bookingMode: 'instant',
    referenceNumber: null,
    bookedDriverId: null,
    bookedRateUsd: null,
    pendingRequestCount: 0,
    createdAt: iso(now),
    updatedAt: iso(now),
    pickedUpAt: null,
    deliveredAt: null,
  };
  const driver = { ...EXAMPLE_DRIVER, availableFrom: iso(new Date(pickup.getTime() - 2 * HOUR_MS)) };
  return { ...load, match: matchLoad(load, driver, { now }) };
}

/** The rig checks shown under the example card, in the engine's words (weight adds the CDL note). */
export function exampleChecks(load: LoadWithMatch): MatchCheck[] {
  const shown: MatchCheck['key'][] = ['equipment', 'weight', 'length', 'deadhead'];
  return shown.flatMap((key) => {
    const check = load.match?.checks.find((c) => c.key === key);
    if (!check) return [];
    return key === 'weight' ? [{ ...check, label: `${check.label}, no CDL needed` }] : [check];
  });
}
