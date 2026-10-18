// LoadSearchFilters <-> query string, in the format GET /api/loads expects (docs/SPEC.md):
// lists comma-separated, booleans "true"/"false", numbers as plain decimals.
import { EQUIPMENT, isEquipmentCode } from '../../../shared/equipment';
import { isStateCode } from '../../../shared/geo';
import type { EquipmentCode, LoadSearchFilters, LoadSort } from '../../../shared/types';

export const LOAD_SORTS: { value: LoadSort; label: string }[] = [
  { value: 'best', label: 'Best match' },
  { value: 'profit', label: 'Most profit' },
  { value: 'rate', label: 'Highest $/mi' },
  { value: 'deadhead', label: 'Least deadhead' },
  { value: 'pickup', label: 'Soonest pickup' },
  { value: 'newest', label: 'Newest' },
];

const SORT_VALUES = new Set<string>(LOAD_SORTS.map((s) => s.value));

/** Serialize filters for a URL or API call. Empty values are left out. */
export function filtersToSearchParams(filters: LoadSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== '') params.set(key, value);
  };
  set('q', filters.q?.trim());
  if (filters.equipment?.length) set('equipment', filters.equipment.join(','));
  set('originCityId', filters.originCityId);
  if (filters.originRadiusMiles !== undefined) set('originRadiusMiles', String(filters.originRadiusMiles));
  if (filters.destinationStates?.length) set('destinationStates', filters.destinationStates.join(','));
  if (filters.minRatePerMile !== undefined) set('minRatePerMile', String(filters.minRatePerMile));
  if (filters.maxWeightLbs !== undefined) set('maxWeightLbs', String(filters.maxWeightLbs));
  set('pickupFrom', filters.pickupFrom);
  set('pickupTo', filters.pickupTo);
  if (filters.hazmat !== undefined) set('hazmat', String(filters.hazmat));
  if (filters.includeIneligible !== undefined) set('includeIneligible', String(filters.includeIneligible));
  set('sort', filters.sort);
  return params;
}

/** Query string for filters, without the leading "?" ('' when empty). */
export function filtersToQueryString(filters: LoadSearchFilters): string {
  return filtersToSearchParams(filters).toString();
}

const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const num = (v: string | null) => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v: string | null) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined);

/** Parse filters from a URL (e.g. the load board's search params). Unknown values are dropped. */
export function filtersFromSearchParams(params: URLSearchParams): LoadSearchFilters {
  const filters: LoadSearchFilters = {};
  const q = params.get('q')?.trim();
  if (q) filters.q = q;
  const equipment = list(params.get('equipment')).filter(isEquipmentCode);
  if (equipment.length) filters.equipment = equipment as EquipmentCode[];
  const origin = params.get('originCityId');
  if (origin) filters.originCityId = origin;
  const radius = num(params.get('originRadiusMiles'));
  if (radius !== undefined) filters.originRadiusMiles = radius;
  const states = list(params.get('destinationStates')).map((s) => s.toUpperCase()).filter(isStateCode);
  if (states.length) filters.destinationStates = states;
  const minRate = num(params.get('minRatePerMile'));
  if (minRate !== undefined) filters.minRatePerMile = minRate;
  const maxWeight = num(params.get('maxWeightLbs'));
  if (maxWeight !== undefined) filters.maxWeightLbs = maxWeight;
  const from = params.get('pickupFrom');
  if (from && !Number.isNaN(Date.parse(from))) filters.pickupFrom = from;
  const to = params.get('pickupTo');
  if (to && !Number.isNaN(Date.parse(to))) filters.pickupTo = to;
  const hazmat = bool(params.get('hazmat'));
  if (hazmat !== undefined) filters.hazmat = hazmat;
  const includeIneligible = bool(params.get('includeIneligible'));
  if (includeIneligible !== undefined) filters.includeIneligible = includeIneligible;
  const sort = params.get('sort');
  if (sort && SORT_VALUES.has(sort)) filters.sort = sort as LoadSort;
  return filters;
}

/** Number of narrowing filters set (sort and includeIneligible do not count). */
export function activeFilterCount(filters: LoadSearchFilters): number {
  let n = 0;
  if (filters.q) n++;
  if (filters.equipment?.length) n++;
  if (filters.originCityId) n++;
  if (filters.destinationStates?.length) n++;
  if (filters.minRatePerMile !== undefined) n++;
  if (filters.maxWeightLbs !== undefined) n++;
  if (filters.pickupFrom || filters.pickupTo) n++;
  if (filters.hazmat !== undefined) n++;
  return n;
}

/** "odessa-tx" -> "Odessa, TX". City ids are name slugs plus the state code. */
export function cityIdToLabel(cityId: string): string {
  const parts = cityId.split('-');
  const state = parts.length > 1 ? parts.pop()!.toUpperCase() : '';
  const name = parts.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join(' ');
  return state ? `${name}, ${state}` : name;
}

/**
 * Short human summary of a saved search, e.g.
 * "Gooseneck or Flatbed · within 100 mi of Odessa, TX · to TX, OK · $2.00+/mi".
 * Pass `cityLabel` when the real city name is known (ids lose punctuation such as "St.").
 */
export function describeFilters(filters: LoadSearchFilters, cityLabel?: string): string {
  const parts: string[] = [];
  if (filters.equipment?.length) parts.push(filters.equipment.map((e) => EQUIPMENT[e].shortLabel).join(' or '));
  if (filters.originCityId) {
    const label = cityLabel ?? cityIdToLabel(filters.originCityId);
    parts.push(`within ${filters.originRadiusMiles ?? 100} mi of ${label}`);
  }
  if (filters.destinationStates?.length) parts.push(`to ${filters.destinationStates.join(', ')}`);
  if (filters.minRatePerMile !== undefined) parts.push(`$${filters.minRatePerMile.toFixed(2)}+/mi`);
  if (filters.maxWeightLbs !== undefined) parts.push(`up to ${filters.maxWeightLbs.toLocaleString('en-US')} lbs`);
  if (filters.hazmat === true) parts.push('hazmat only');
  if (filters.hazmat === false) parts.push('no hazmat');
  if (filters.q) parts.push(`“${filters.q}”`);
  return parts.length ? parts.join(' · ') : 'Any load that fits your rig';
}
