// Post/edit load form: values, defaults, the client copy of the server's load rules
// (server/routes/loads.ts), and conversion to API bodies.
import {
  HOTSHOT_EQUIPMENT,
  HOTSHOT_MAX_LENGTH_FT,
  HOTSHOT_MAX_PAYLOAD_LBS,
  NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS,
} from '../../../../../shared/equipment';
import type { BookingMode, City, EquipmentCode, Load, LoadSize } from '../../../../../shared/types';
import { placeToCity } from '../../../components/CityInput';
import type { ApiError, LoadInput, LoadUpdate } from '../../../lib/api';
import { feet, lbs } from '../../../lib/format';

export interface LoadFormValues {
  origin: City | null;
  destination: City | null;
  pickupStart: string | null;
  pickupEnd: string | null;
  deliveryBy: string | null;
  commodity: string;
  weightLbs: number | null;
  lengthFt: number | null;
  loadSize: LoadSize;
  hazmat: boolean;
  tarpRequired: boolean;
  teamRequired: boolean;
  notes: string;
  equipmentTypes: EquipmentCode[];
  rateUsd: number | null;
  bookingMode: BookingMode;
  referenceNumber: string;
}

export type LoadField = keyof LoadFormValues;
export type LoadFormErrors = Partial<Record<LoadField, string>>;

export const LOAD_LIMITS = {
  weightMax: 200_000,
  lengthMax: 100,
  rateMin: 50,
  rateMax: 100_000,
  commodityMax: 120,
  notesMax: 2000,
  referenceMax: 40,
} as const;

const HOUR_MS = 3_600_000;
const DEFAULT_WINDOW_HOURS = 4;

/** Tomorrow 8:00 AM to noon, local time: the most common pickup ask. */
export function defaultPickupWindow(now: Date): { pickupStart: string; pickupEnd: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
  return { pickupStart: start.toISOString(), pickupEnd: addHours(start.toISOString(), DEFAULT_WINDOW_HOURS) };
}

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

export function emptyLoadValues(now: Date): LoadFormValues {
  return {
    origin: null,
    destination: null,
    ...defaultPickupWindow(now),
    deliveryBy: null,
    commodity: '',
    weightLbs: null,
    lengthFt: null,
    loadSize: 'full',
    hazmat: false,
    tarpRequired: false,
    teamRequired: false,
    notes: '',
    equipmentTypes: [],
    rateUsd: null,
    bookingMode: 'request',
    referenceNumber: '',
  };
}

/** Edit keeps the load's dates; a repost gets fresh default dates and no delivery deadline. */
export function loadToValues(load: Load, mode: 'edit' | 'repost', now: Date): LoadFormValues {
  const dates =
    mode === 'edit'
      ? { pickupStart: load.pickupStart, pickupEnd: load.pickupEnd, deliveryBy: load.deliveryBy }
      : { ...defaultPickupWindow(now), deliveryBy: null };
  return {
    origin: placeToCity(load.origin),
    destination: placeToCity(load.destination),
    ...dates,
    commodity: load.commodity,
    weightLbs: load.weightLbs,
    lengthFt: load.lengthFt,
    loadSize: load.loadSize,
    hazmat: load.hazmat,
    tarpRequired: load.tarpRequired,
    teamRequired: load.teamRequired,
    notes: load.notes,
    equipmentTypes: [...load.equipmentTypes],
    rateUsd: load.rateUsd,
    bookingMode: load.bookingMode,
    referenceNumber: load.referenceNumber ?? '',
  };
}

// ---------------------------------------------------------------------------
// Validation (mirrors loadFieldsSchema + checkLoadRules on the server)
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  now: Date;
  /** The server only rejects a past pickup window when the window is being set (new loads, or edited dates). */
  checkFuturePickup: boolean;
}

const isWhole = (n: number) => Number.isInteger(n);

export function validateLoad(v: LoadFormValues, { now, checkFuturePickup }: ValidateOptions): LoadFormErrors {
  const e: LoadFormErrors = {};

  if (!v.origin) e.origin = 'Pick the pickup city';
  if (!v.destination) e.destination = 'Pick the delivery city';
  else if (v.origin && v.origin.id === v.destination.id) e.destination = 'Delivery must be in a different city than pickup';

  const start = v.pickupStart ? Date.parse(v.pickupStart) : NaN;
  const end = v.pickupEnd ? Date.parse(v.pickupEnd) : NaN;
  if (Number.isNaN(start)) e.pickupStart = 'Set when pickup opens';
  if (Number.isNaN(end)) e.pickupEnd = 'Set when pickup closes';
  else if (!Number.isNaN(start) && end < start) e.pickupEnd = 'Pickup window must end after it starts';
  else if (checkFuturePickup && end <= now.getTime()) e.pickupEnd = 'Pickup window must end in the future';
  if (v.deliveryBy && !Number.isNaN(start) && Date.parse(v.deliveryBy) < start) {
    e.deliveryBy = 'Delivery deadline must be after pickup starts';
  }

  const commodity = v.commodity.trim();
  if (!commodity) e.commodity = 'Say what the freight is';
  else if (commodity.length > LOAD_LIMITS.commodityMax) e.commodity = `Keep it under ${LOAD_LIMITS.commodityMax} characters`;

  if (v.weightLbs === null) e.weightLbs = 'Enter the weight';
  else if (!isWhole(v.weightLbs) || v.weightLbs < 1 || v.weightLbs > LOAD_LIMITS.weightMax) {
    e.weightLbs = `Enter whole pounds from 1 to ${lbs(LOAD_LIMITS.weightMax)}`;
  }
  if (v.lengthFt === null) e.lengthFt = 'Enter the length';
  else if (v.lengthFt < 1 || v.lengthFt > LOAD_LIMITS.lengthMax) e.lengthFt = `Enter 1 to ${LOAD_LIMITS.lengthMax} ft`;

  if (v.notes.trim().length > LOAD_LIMITS.notesMax) e.notes = `Keep notes under ${LOAD_LIMITS.notesMax} characters`;
  if (v.equipmentTypes.length === 0) e.equipmentTypes = 'Pick at least one trailer type';

  if (v.rateUsd === null) e.rateUsd = 'Enter the rate you will pay';
  else if (!isWhole(v.rateUsd) || v.rateUsd < LOAD_LIMITS.rateMin || v.rateUsd > LOAD_LIMITS.rateMax) {
    e.rateUsd = `Enter whole dollars from $${LOAD_LIMITS.rateMin} to $${LOAD_LIMITS.rateMax.toLocaleString('en-US')}`;
  }

  if (v.referenceNumber.trim().length > LOAD_LIMITS.referenceMax) {
    e.referenceNumber = `Keep it under ${LOAD_LIMITS.referenceMax} characters`;
  }
  return e;
}

export const hasErrors = (errors: LoadFormErrors) => Object.values(errors).some(Boolean);

// ---------------------------------------------------------------------------
// API bodies
// ---------------------------------------------------------------------------

/** The POST body. Call only after validateLoad found nothing. */
export function toLoadInput(v: LoadFormValues): LoadInput {
  const reference = v.referenceNumber.trim();
  return {
    originCityId: v.origin!.id,
    destinationCityId: v.destination!.id,
    pickupStart: v.pickupStart!,
    pickupEnd: v.pickupEnd!,
    deliveryBy: v.deliveryBy ?? undefined,
    equipmentTypes: v.equipmentTypes,
    weightLbs: v.weightLbs!,
    lengthFt: v.lengthFt!,
    commodity: v.commodity.trim(),
    notes: v.notes.trim(),
    loadSize: v.loadSize,
    hazmat: v.hazmat,
    tarpRequired: v.tarpRequired,
    teamRequired: v.teamRequired,
    rateUsd: v.rateUsd!,
    bookingMode: v.bookingMode,
    referenceNumber: reference || undefined,
  };
}

const sameTime = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);

const sameSet = (a: EquipmentCode[], b: EquipmentCode[]) =>
  a.length === b.length && a.every((code) => b.includes(code));

/**
 * True when the form still holds what it started with, so leaving loses nothing. Text is compared
 * trimmed (a stray space is not work to lose) and times as instants.
 */
export function sameLoadValues(a: LoadFormValues, b: LoadFormValues): boolean {
  return (
    (a.origin?.id ?? null) === (b.origin?.id ?? null) &&
    (a.destination?.id ?? null) === (b.destination?.id ?? null) &&
    sameTime(a.pickupStart, b.pickupStart) &&
    sameTime(a.pickupEnd, b.pickupEnd) &&
    sameTime(a.deliveryBy, b.deliveryBy) &&
    a.commodity.trim() === b.commodity.trim() &&
    a.weightLbs === b.weightLbs &&
    a.lengthFt === b.lengthFt &&
    a.loadSize === b.loadSize &&
    a.hazmat === b.hazmat &&
    a.tarpRequired === b.tarpRequired &&
    a.teamRequired === b.teamRequired &&
    a.notes.trim() === b.notes.trim() &&
    sameSet(a.equipmentTypes, b.equipmentTypes) &&
    a.rateUsd === b.rateUsd &&
    a.bookingMode === b.bookingMode &&
    a.referenceNumber.trim() === b.referenceNumber.trim()
  );
}

/** True when the edit touches the pickup window (the server then re-checks it is in the future). */
export function pickupWindowChanged(v: LoadFormValues, original: Load): boolean {
  return !sameTime(v.pickupStart, original.pickupStart) || !sameTime(v.pickupEnd, original.pickupEnd);
}

/**
 * True when the edit moves the lane, the pickup window or the delivery deadline. Saving such an edit
 * cancels the load's waiting requests (PATCH /api/loads/:id), and each driver is asked to send a new
 * one, so the form warns first. Works on a half-filled form: a cleared city counts as a change.
 */
export function changesLaneOrSchedule(v: LoadFormValues, original: Load): boolean {
  return (
    (v.origin?.id ?? null) !== original.origin.cityId ||
    (v.destination?.id ?? null) !== original.destination.cityId ||
    pickupWindowChanged(v, original) ||
    !sameTime(v.deliveryBy ?? null, original.deliveryBy)
  );
}

/** The PATCH body: only fields that differ from the load as posted. Empty when nothing changed. */
export function toLoadUpdate(v: LoadFormValues, original: Load): LoadUpdate {
  const next = toLoadInput(v);
  const update: LoadUpdate = {};
  if (next.originCityId !== original.origin.cityId) update.originCityId = next.originCityId;
  if (next.destinationCityId !== original.destination.cityId) update.destinationCityId = next.destinationCityId;
  if (!sameTime(next.pickupStart, original.pickupStart)) update.pickupStart = next.pickupStart;
  if (!sameTime(next.pickupEnd, original.pickupEnd)) update.pickupEnd = next.pickupEnd;
  const deliveryBy = v.deliveryBy ?? null;
  if (!sameTime(deliveryBy, original.deliveryBy)) update.deliveryBy = deliveryBy;
  if (!sameSet(next.equipmentTypes, original.equipmentTypes)) update.equipmentTypes = next.equipmentTypes;
  if (next.weightLbs !== original.weightLbs) update.weightLbs = next.weightLbs;
  if (next.lengthFt !== original.lengthFt) update.lengthFt = next.lengthFt;
  if (next.commodity !== original.commodity) update.commodity = next.commodity;
  if ((next.notes ?? '') !== original.notes) update.notes = next.notes;
  if (next.loadSize !== original.loadSize) update.loadSize = next.loadSize;
  if (next.hazmat !== original.hazmat) update.hazmat = next.hazmat;
  if (next.tarpRequired !== original.tarpRequired) update.tarpRequired = next.tarpRequired;
  if (next.teamRequired !== original.teamRequired) update.teamRequired = next.teamRequired;
  if (next.rateUsd !== original.rateUsd) update.rateUsd = next.rateUsd;
  if (next.bookingMode !== original.bookingMode) update.bookingMode = next.bookingMode;
  const reference = next.referenceNumber ?? null;
  if (reference !== original.referenceNumber) update.referenceNumber = reference;
  return update;
}

const API_FIELDS: Record<string, LoadField> = {
  originCityId: 'origin',
  destinationCityId: 'destination',
  pickupStart: 'pickupStart',
  pickupEnd: 'pickupEnd',
  deliveryBy: 'deliveryBy',
  equipmentTypes: 'equipmentTypes',
  weightLbs: 'weightLbs',
  lengthFt: 'lengthFt',
  commodity: 'commodity',
  notes: 'notes',
  loadSize: 'loadSize',
  hazmat: 'hazmat',
  tarpRequired: 'tarpRequired',
  teamRequired: 'teamRequired',
  rateUsd: 'rateUsd',
  bookingMode: 'bookingMode',
  referenceNumber: 'referenceNumber',
};

/** Server field issues ("equipmentTypes.0", "destinationCityId") mapped onto form fields. */
export function apiErrorsToFields(err: ApiError): LoadFormErrors {
  const out: LoadFormErrors = {};
  for (const [path, message] of Object.entries(err.fieldErrors())) {
    const field = API_FIELDS[path.split('.')[0]];
    if (field && !out[field]) out[field] = message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hotshot fit
// ---------------------------------------------------------------------------

/** What the "Open to hotshot" switch adds: the two hotshot setups that haul general flatbed freight. */
export const HOTSHOT_SWITCH_CODES: EquipmentCode[] = ['HS_GOOSENECK', 'HS_DOVETAIL'];

export function isOpenToHotshot(codes: EquipmentCode[]): boolean {
  return codes.some((c) => HOTSHOT_EQUIPMENT.includes(c));
}

/** Turning on adds gooseneck + dovetail; turning off removes every hotshot setup. */
export function setOpenToHotshot(codes: EquipmentCode[], on: boolean): EquipmentCode[] {
  if (!on) return codes.filter((c) => !HOTSHOT_EQUIPMENT.includes(c));
  return [...codes, ...HOTSHOT_SWITCH_CODES.filter((c) => !codes.includes(c))];
}

/** "32 ft", "32.5 ft": freight length keeps its decimal so 40.5 ft never reads as fitting a 40 ft deck. */
export function lengthLabel(ft: number): string {
  return `${Number.isInteger(ft) ? ft : ft.toFixed(1)} ft`;
}

export interface HotshotFit {
  /** False until both weight and length are entered. */
  known: boolean;
  fits: boolean;
  /** Why it does not fit, in plain words. */
  problems: string[];
  /** Heavier than a non-CDL hotshot may carry, so only CDL hotshots qualify. */
  needsCdl: boolean;
}

export function hotshotFit(weightLbs: number | null, lengthFt: number | null): HotshotFit {
  const problems: string[] = [];
  if (weightLbs !== null && weightLbs > HOTSHOT_MAX_PAYLOAD_LBS) {
    problems.push(`${lbs(weightLbs)} is more than the ${lbs(HOTSHOT_MAX_PAYLOAD_LBS)} a typical hotshot can carry`);
  }
  if (lengthFt !== null && lengthFt > HOTSHOT_MAX_LENGTH_FT) {
    problems.push(`${lengthLabel(lengthFt)} is longer than a ${feet(HOTSHOT_MAX_LENGTH_FT)} gooseneck deck`);
  }
  return {
    known: weightLbs !== null && lengthFt !== null,
    fits: problems.length === 0,
    problems,
    needsCdl: weightLbs !== null && weightLbs > NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS && weightLbs <= HOTSHOT_MAX_PAYLOAD_LBS,
  };
}
