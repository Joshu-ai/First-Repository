import { z } from 'zod';
import { EQUIPMENT_CODES } from '../shared/equipment';
import { roadMiles, STATE_CODES, US_STATES } from '../shared/geo';
import { cityNameForms, getCity, normalizeSearchText } from '../shared/cities';
import type { EquipmentCode, Load, LoadSearchFilters, LoadSort, Place } from '../shared/types';
import { parse } from './http';

const LOAD_SORTS = ['best', 'rate', 'deadhead', 'pickup', 'newest', 'profit'] as const satisfies readonly LoadSort[];

export const equipmentCodeSchema = z.enum(EQUIPMENT_CODES as [EquipmentCode, ...EquipmentCode[]]);
export const stateCodeSchema = z.string().refine((s) => STATE_CODES.includes(s), 'Unknown state code');
export const isoDateSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

/** LoadSearchFilters as JSON (saved searches). Unknown keys are stripped. */
export const filtersSchema = z.object({
  q: z.string().trim().max(80).optional(),
  equipment: z.array(equipmentCodeSchema).max(EQUIPMENT_CODES.length).optional(),
  originCityId: z.string().refine((id) => getCity(id) !== undefined, 'Unknown city').optional(),
  originRadiusMiles: z.number().int().min(10).max(1000).optional(),
  destinationStates: z.array(stateCodeSchema).max(STATE_CODES.length).optional(),
  minRatePerMile: z.number().min(0).max(20).optional(),
  maxWeightLbs: z.number().int().min(1).max(200_000).optional(),
  pickupFrom: isoDateSchema.optional(),
  pickupTo: isoDateSchema.optional(),
  hazmat: z.boolean().optional(),
  includeIneligible: z.boolean().optional(),
  sort: z.enum(LOAD_SORTS).optional(),
}) satisfies z.ZodType<LoadSearchFilters>;

/** Comma-separated list; a repeated param (`?equipment=A&equipment=B`) arrives as an array. */
const list = (v: unknown) => {
  const joined = Array.isArray(v) ? v.filter((s) => typeof s === 'string').join(',') : v;
  if (typeof joined !== 'string') return undefined;
  const items = joined.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
};
const number = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined);
/** Unrecognised text passes through unchanged so z.boolean() rejects it with a 400 instead of ignoring it. */
const boolean = (v: unknown) => {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
};
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** Parse LoadSearchFilters from a query string (`?equipment=A,B&minRatePerMile=2&hazmat=false`). */
export function parseFilterQuery(query: Record<string, unknown>): LoadSearchFilters {
  const raw = {
    q: text(query.q),
    equipment: list(query.equipment),
    originCityId: text(query.originCityId),
    originRadiusMiles: number(query.originRadiusMiles),
    destinationStates: list(query.destinationStates)?.map((s) => s.toUpperCase()),
    minRatePerMile: number(query.minRatePerMile),
    maxWeightLbs: number(query.maxWeightLbs),
    pickupFrom: text(query.pickupFrom),
    pickupTo: text(query.pickupTo),
    hazmat: boolean(query.hazmat),
    includeIneligible: boolean(query.includeIneligible),
    sort: text(query.sort),
  };
  const defined = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  return parse(filtersSchema, defined);
}

/** Default search radius when originCityId is given without a radius. */
export const DEFAULT_ORIGIN_RADIUS_MILES = 100;

/**
 * Every way a driver might type a place, normalized like the city picker: "st louis", "saint louis",
 * "st louis mo", "st louis missouri", "ft worth tx", "winston salem".
 */
function placeSearchForms(place: Place): string[] {
  const code = place.state.toLowerCase();
  const stateName = normalizeSearchText(US_STATES[place.state] ?? '');
  return cityNameForms(place.city).flatMap((name) => [`${name} ${code}`, `${name} ${stateName}`]);
}

/** True when `q` appears in the load's freight, notes, reference, places or shipper, compared like searchCities. */
function loadMentions(load: Load, q: string): boolean {
  const needle = normalizeSearchText(q);
  // Nothing searchable left (just punctuation): no text filter.
  if (!needle) return true;
  const fields = [
    ...[load.commodity, load.notes, load.referenceNumber ?? '', load.shipperCompany ?? load.shipperName].map(normalizeSearchText),
    ...placeSearchForms(load.origin),
    ...placeSearchForms(load.destination),
  ];
  // Fields are joined with a separator no normalized query contains, so a match never spans two fields.
  return fields.join(' | ').includes(needle);
}

/**
 * Load-only filters (no driver context). Eligibility/includeIneligible and sort are applied by the caller.
 * hazmat: true = only hazmat loads, false = exclude hazmat loads, undefined = both.
 */
export function loadPassesFilters(load: Load, filters: LoadSearchFilters): boolean {
  if (filters.q && !loadMentions(load, filters.q)) return false;
  if (filters.equipment?.length && !load.equipmentTypes.some((e) => filters.equipment!.includes(e))) return false;
  if (filters.originCityId) {
    const city = getCity(filters.originCityId);
    const radius = filters.originRadiusMiles ?? DEFAULT_ORIGIN_RADIUS_MILES;
    if (city && roadMiles(city, load.origin) > radius) return false;
  }
  if (filters.destinationStates?.length && !filters.destinationStates.includes(load.destination.state)) return false;
  if (filters.minRatePerMile !== undefined && load.ratePerMile < filters.minRatePerMile) return false;
  if (filters.maxWeightLbs !== undefined && load.weightLbs > filters.maxWeightLbs) return false;
  if (filters.pickupFrom && Date.parse(load.pickupEnd) < Date.parse(filters.pickupFrom)) return false;
  if (filters.pickupTo && Date.parse(load.pickupStart) > Date.parse(filters.pickupTo)) return false;
  if (filters.hazmat !== undefined && load.hazmat !== filters.hazmat) return false;
  return true;
}
