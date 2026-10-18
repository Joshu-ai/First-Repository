// Editable form of LoadSearchFilters for the load board's filter panel and the alert editor.
import { EQUIPMENT } from '../../../../../shared/equipment';
import type { City, EquipmentCode, LoadSearchFilters } from '../../../../../shared/types';
import { cityIdToLabel } from '../../../lib/filters';
import { lbs, money, place, shortDate } from '../../../lib/format';

export type HazmatChoice = 'any' | 'only' | 'none';

export interface FilterDraft {
  q: string;
  equipment: EquipmentCode[];
  originCity: City | null;
  originRadiusMiles: number;
  destinationStates: string[];
  minRatePerMile: number | null;
  maxWeightLbs: number | null;
  /** Local calendar dates, "YYYY-MM-DD" ('' = not set). */
  pickupFrom: string;
  pickupTo: string;
  hazmat: HazmatChoice;
  includeIneligible: boolean;
}

export type FilterField = keyof FilterDraft;
export type FilterErrors = Partial<Record<FilterField, string>>;

export const DEFAULT_RADIUS_MILES = 100;
export const RADIUS_CHOICES = [25, 50, 100, 150, 250, 500];

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO timestamp -> local "YYYY-MM-DD" for <input type="date">. */
export function isoToDateInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Start of a local day as ISO, so "pickup from Oct 20" includes the whole day. */
export function dateInputToStartIso(value: string): string | undefined {
  return parseDateInput(value)?.toISOString();
}

/** End of a local day as ISO, so "pickup by Oct 21" includes loads picking up late that day. */
export function dateInputToEndIso(value: string): string | undefined {
  const d = parseDateInput(value);
  if (!d) return undefined;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function emptyDraft(): FilterDraft {
  return {
    q: '',
    equipment: [],
    originCity: null,
    originRadiusMiles: DEFAULT_RADIUS_MILES,
    destinationStates: [],
    minRatePerMile: null,
    maxWeightLbs: null,
    pickupFrom: '',
    pickupTo: '',
    hazmat: 'any',
    includeIneligible: false,
  };
}

export function draftFromFilters(filters: LoadSearchFilters, originCity: City | null): FilterDraft {
  return {
    q: filters.q ?? '',
    equipment: filters.equipment ?? [],
    originCity: filters.originCityId ? originCity : null,
    originRadiusMiles: filters.originRadiusMiles ?? DEFAULT_RADIUS_MILES,
    destinationStates: filters.destinationStates ?? [],
    minRatePerMile: filters.minRatePerMile ?? null,
    maxWeightLbs: filters.maxWeightLbs ?? null,
    pickupFrom: isoToDateInput(filters.pickupFrom),
    pickupTo: isoToDateInput(filters.pickupTo),
    hazmat: filters.hazmat === true ? 'only' : filters.hazmat === false ? 'none' : 'any',
    includeIneligible: filters.includeIneligible ?? false,
  };
}

/** Filters for the API/URL. `keep` carries settings the panel does not edit (sort). */
export function filtersFromDraft(d: FilterDraft, keep: Pick<LoadSearchFilters, 'sort'> = {}): LoadSearchFilters {
  const out: LoadSearchFilters = {};
  const q = d.q.trim();
  if (q) out.q = q;
  if (d.equipment.length) out.equipment = [...d.equipment];
  if (d.originCity) {
    out.originCityId = d.originCity.id;
    out.originRadiusMiles = d.originRadiusMiles;
  }
  if (d.destinationStates.length) out.destinationStates = [...d.destinationStates].sort();
  if (d.minRatePerMile !== null) out.minRatePerMile = d.minRatePerMile;
  if (d.maxWeightLbs !== null) out.maxWeightLbs = d.maxWeightLbs;
  const from = dateInputToStartIso(d.pickupFrom);
  if (from) out.pickupFrom = from;
  const to = dateInputToEndIso(d.pickupTo);
  if (to) out.pickupTo = to;
  if (d.hazmat !== 'any') out.hazmat = d.hazmat === 'only';
  if (d.includeIneligible) out.includeIneligible = true;
  if (keep.sort) out.sort = keep.sort;
  return out;
}

/** Same ranges as the API's filter schema (server/filters.ts). */
export function validateFilterDraft(d: FilterDraft): FilterErrors {
  const errors: FilterErrors = {};
  if (d.q.trim().length > 80) errors.q = 'Keep the keyword under 80 characters';
  if (d.originCity && (d.originRadiusMiles < 10 || d.originRadiusMiles > 1000)) {
    errors.originRadiusMiles = 'Radius runs 10 to 1,000 mi';
  }
  if (d.minRatePerMile !== null && (d.minRatePerMile < 0 || d.minRatePerMile > 20)) {
    errors.minRatePerMile = 'Use $0 to $20 per mile';
  }
  if (d.maxWeightLbs !== null && (d.maxWeightLbs < 1 || d.maxWeightLbs > 200_000 || !Number.isInteger(d.maxWeightLbs))) {
    errors.maxWeightLbs = 'Use whole pounds up to 200,000';
  }
  if (d.pickupFrom && d.pickupTo && d.pickupTo < d.pickupFrom) errors.pickupTo = 'Pick a day on or after the start';
  return errors;
}

/** Maps API issue paths ("filters.minRatePerMile", "originCityId") onto draft fields. */
export function filterErrorsFromPaths(fieldErrors: Record<string, string>): FilterErrors {
  const map: Record<string, FilterField> = {
    q: 'q',
    equipment: 'equipment',
    originCityId: 'originCity',
    originRadiusMiles: 'originRadiusMiles',
    destinationStates: 'destinationStates',
    minRatePerMile: 'minRatePerMile',
    maxWeightLbs: 'maxWeightLbs',
    pickupFrom: 'pickupFrom',
    pickupTo: 'pickupTo',
    hazmat: 'hazmat',
  };
  const out: FilterErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const parts = path.split('.');
    const key = parts[0] === 'filters' ? parts[1] : parts[0];
    const field = key ? map[key] : undefined;
    if (field && !out[field]) out[field] = message;
  }
  return out;
}

export interface FilterChip {
  key: string;
  label: string;
  /** The filters with this one removed. */
  without: (filters: LoadSearchFilters) => LoadSearchFilters;
}

const omit = (...keys: (keyof LoadSearchFilters)[]) => (filters: LoadSearchFilters) => {
  const next = { ...filters };
  for (const key of keys) delete next[key];
  return next;
};

/** One removable chip per active filter, for the strip above the results. */
export function filterChips(filters: LoadSearchFilters, originCity: City | null, now: Date = new Date()): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.originCityId) {
    const label = originCity?.state ? place(originCity) : cityIdToLabel(filters.originCityId);
    chips.push({
      key: 'origin',
      label: `Within ${filters.originRadiusMiles ?? DEFAULT_RADIUS_MILES} mi of ${label}`,
      without: omit('originCityId', 'originRadiusMiles'),
    });
  }
  if (filters.destinationStates?.length) {
    chips.push({ key: 'dest', label: `To ${filters.destinationStates.join(', ')}`, without: omit('destinationStates') });
  }
  if (filters.equipment?.length) {
    chips.push({
      key: 'equipment',
      label: filters.equipment.map((e) => EQUIPMENT[e].shortLabel).join(' or '),
      without: omit('equipment'),
    });
  }
  if (filters.minRatePerMile !== undefined) {
    chips.push({ key: 'rate', label: `${money(filters.minRatePerMile, { cents: true })}+/mi`, without: omit('minRatePerMile') });
  }
  if (filters.maxWeightLbs !== undefined) {
    chips.push({ key: 'weight', label: `Up to ${lbs(filters.maxWeightLbs)}`, without: omit('maxWeightLbs') });
  }
  if (filters.pickupFrom || filters.pickupTo) {
    const from = filters.pickupFrom ? shortDate(filters.pickupFrom, now) : null;
    const to = filters.pickupTo ? shortDate(filters.pickupTo, now) : null;
    const label = from && to ? (from === to ? `Pickup ${from}` : `Pickup ${from} – ${to}`) : from ? `Pickup from ${from}` : `Pickup by ${to}`;
    chips.push({ key: 'pickup', label, without: omit('pickupFrom', 'pickupTo') });
  }
  if (filters.hazmat !== undefined) {
    chips.push({ key: 'hazmat', label: filters.hazmat ? 'Hazmat only' : 'No hazmat', without: omit('hazmat') });
  }
  if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, without: omit('q') });
  if (filters.includeIneligible) {
    chips.push({ key: 'ineligible', label: 'Incl. loads you can’t take', without: omit('includeIneligible') });
  }
  return chips;
}

/** Alerts only ever ping for loads the driver can take, so that switch is not saved with one. */
export function filtersForAlert(filters: LoadSearchFilters): LoadSearchFilters {
  const next = { ...filters };
  delete next.includeIneligible;
  return next;
}
