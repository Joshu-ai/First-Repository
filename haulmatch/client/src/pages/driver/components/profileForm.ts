// Editable copy of a DriverProfile, split into the sections the setup wizard walks through and
// the profile page shows. Validation mirrors PUT /api/drivers/me/profile so most mistakes are
// caught before a round trip; the API's field errors map onto the same keys.
import {
  DRIVER_CLASSES,
  EQUIPMENT,
  NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS,
  equipmentForClass,
} from '../../../../../shared/equipment';
import type { City, DriverClass, DriverProfile, Endorsement, EquipmentCode } from '../../../../../shared/types';
import { placeToCityOrNull } from '../../../components/CityInput';
import type { ApiError, DriverProfileUpdate } from '../../../lib/api';

export type SectionId = 'rig' | 'equipment' | 'capacity' | 'location' | 'preferences';

/** now = empty and ready; later = empty from a set time; off = not taking loads. */
export type Availability = 'now' | 'later' | 'off';

export interface ProfileDraft {
  driverClass: DriverClass;
  equipmentTypes: EquipmentCode[];
  trailerLengthFt: number | null;
  maxPayloadLbs: number | null;
  hasCdl: boolean;
  cdlClass: 'A' | 'B' | null;
  endorsements: Endorsement[];
  teamDriver: boolean;
  truckDescription: string;
  mcNumber: string;
  dotNumber: string;
  currentCity: City | null;
  homeCity: City | null;
  availability: Availability;
  availableFrom: string | null;
  maxDeadheadMiles: number | null;
  minRatePerMile: number | null;
  preferredStates: string[];
  avoidStates: string[];
  mpg: number | null;
  fuelPricePerGallon: number | null;
}

/** Error messages keyed by the API's field names (cities use currentCityId / homeCityId). */
export type ProfileErrors = Partial<Record<keyof DriverProfileUpdate, string>>;

export const ENDORSEMENTS: Endorsement[] = ['hazmat', 'tanker', 'doubles_triples', 'twic'];
/** A TWIC card is a port credential; the others only exist on a CDL (the API drops them without one). */
export const CDL_ONLY_ENDORSEMENTS: Endorsement[] = ['hazmat', 'tanker', 'doubles_triples'];

export const LIMITS = {
  trailerLengthFt: { min: 8, max: 60 },
  maxPayloadLbs: { min: 500, max: 80_000 },
  truckDescription: { max: 120 },
  mcNumber: { max: 12 },
  dotNumber: { max: 10 },
  maxDeadheadMiles: { min: 0, max: 1000 },
  minRatePerMile: { min: 0, max: 20 },
  mpg: { min: 2, max: 40 },
  fuelPricePerGallon: { min: 1, max: 15 },
} as const;

/** Capacity a fresh profile gets per class (docs/SPEC.md "Driver profile defaults on register"). */
const CLASS_CAPACITY: Record<DriverClass, { trailerLengthFt: number; maxPayloadLbs: number }> = {
  hotshot: { trailerLengthFt: 40, maxPayloadLbs: NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS },
  semi: { trailerLengthFt: 53, maxPayloadLbs: 45_000 },
};

const SECTION_FIELDS: Record<SectionId, (keyof DriverProfileUpdate)[]> = {
  rig: ['driverClass'],
  equipment: ['equipmentTypes'],
  capacity: [
    'trailerLengthFt',
    'maxPayloadLbs',
    'hasCdl',
    'cdlClass',
    'endorsements',
    'teamDriver',
    'truckDescription',
    'mcNumber',
    'dotNumber',
  ],
  location: ['currentCityId', 'homeCityId', 'available', 'availableFrom'],
  preferences: ['maxDeadheadMiles', 'minRatePerMile', 'preferredStates', 'avoidStates', 'mpg', 'fuelPricePerGallon'],
};

export const SECTION_ORDER: SectionId[] = ['rig', 'equipment', 'capacity', 'location', 'preferences'];

export function draftFromProfile(p: DriverProfile, now: Date = new Date()): ProfileDraft {
  const later = p.available && p.availableFrom !== null && Date.parse(p.availableFrom) > now.getTime();
  return {
    driverClass: p.driverClass,
    equipmentTypes: p.equipmentTypes,
    trailerLengthFt: p.trailerLengthFt,
    maxPayloadLbs: p.maxPayloadLbs,
    hasCdl: p.hasCdl,
    cdlClass: p.cdlClass,
    endorsements: p.endorsements,
    teamDriver: p.teamDriver,
    truckDescription: p.truckDescription,
    mcNumber: p.mcNumber ?? '',
    dotNumber: p.dotNumber ?? '',
    currentCity: placeToCityOrNull(p.currentLocation),
    homeCity: placeToCityOrNull(p.homeBase),
    availability: !p.available ? 'off' : later ? 'later' : 'now',
    availableFrom: later ? p.availableFrom : null,
    maxDeadheadMiles: p.maxDeadheadMiles,
    minRatePerMile: p.minRatePerMile,
    preferredStates: p.preferredStates,
    avoidStates: p.avoidStates,
    mpg: p.mpg,
    fuelPricePerGallon: p.fuelPricePerGallon,
  };
}

/** "MC-1184520" or "DOT # 3365871" -> "1184520". */
export function cleanAuthorityNumber(value: string): string {
  return value.replace(/^\s*(mc|usdot|dot)\s*[#:-]?\s*/i, '').replace(/[\s-]/g, '');
}

const sorted = <T>(values: T[]): T[] => [...values].sort();

/** The PUT body for one section. Numbers are only sent once valid (see validateSection). */
export function sectionUpdate(section: SectionId, d: ProfileDraft): DriverProfileUpdate {
  switch (section) {
    case 'rig':
      return {
        driverClass: d.driverClass,
        equipmentTypes: d.equipmentTypes.filter((c) => equipmentForClass(d.driverClass).includes(c)),
      };
    case 'equipment':
      return { equipmentTypes: sorted(d.equipmentTypes) };
    case 'capacity':
      return {
        trailerLengthFt: d.trailerLengthFt ?? undefined,
        maxPayloadLbs: d.maxPayloadLbs ?? undefined,
        hasCdl: d.hasCdl,
        cdlClass: d.hasCdl ? d.cdlClass : null,
        endorsements: sorted(d.hasCdl ? d.endorsements : d.endorsements.filter((e) => !CDL_ONLY_ENDORSEMENTS.includes(e))),
        teamDriver: d.teamDriver,
        truckDescription: d.truckDescription.trim(),
        mcNumber: cleanAuthorityNumber(d.mcNumber) || null,
        dotNumber: cleanAuthorityNumber(d.dotNumber) || null,
      };
    case 'location':
      return {
        currentCityId: d.currentCity?.id ?? null,
        homeCityId: d.homeCity?.id ?? null,
        available: d.availability !== 'off',
        availableFrom: d.availability === 'later' ? d.availableFrom : null,
      };
    case 'preferences':
      return {
        maxDeadheadMiles: d.maxDeadheadMiles ?? undefined,
        minRatePerMile: d.minRatePerMile ?? undefined,
        preferredStates: sorted(d.preferredStates),
        avoidStates: sorted(d.avoidStates),
        mpg: d.mpg ?? undefined,
        fuelPricePerGallon: d.fuelPricePerGallon ?? undefined,
      };
  }
}

export function fullUpdate(d: ProfileDraft): DriverProfileUpdate {
  return Object.assign({}, ...SECTION_ORDER.map((s) => sectionUpdate(s, d))) as DriverProfileUpdate;
}

/** True when saving the draft would change nothing. */
export function sameDraft(a: ProfileDraft, b: ProfileDraft): boolean {
  return JSON.stringify(fullUpdate(a)) === JSON.stringify(fullUpdate(b));
}

const fmt = (n: number) => n.toLocaleString('en-US');

function checkRange(
  errors: ProfileErrors,
  field: keyof typeof LIMITS & keyof DriverProfileUpdate,
  value: number | null,
  empty: string,
  range: (min: string, max: string) => string,
): void {
  const limit = LIMITS[field] as { min?: number; max: number };
  if (value === null) errors[field] = empty;
  else if ((limit.min !== undefined && value < limit.min) || value > limit.max) {
    errors[field] = range(fmt(limit.min ?? 0), fmt(limit.max));
  }
}

export function validateSection(section: SectionId, d: ProfileDraft, now: Date = new Date()): ProfileErrors {
  const errors: ProfileErrors = {};
  switch (section) {
    case 'rig':
      break;
    case 'equipment':
      if (d.equipmentTypes.length === 0) errors.equipmentTypes = 'Pick at least one trailer you can pull';
      break;
    case 'capacity': {
      checkRange(errors, 'trailerLengthFt', d.trailerLengthFt, 'Enter your deck length', (a, b) => `Deck length runs ${a} to ${b} ft`);
      checkRange(errors, 'maxPayloadLbs', d.maxPayloadLbs, 'Enter how much you can haul', (a, b) => `Payload runs ${a} to ${b} lbs`);
      if (d.maxPayloadLbs !== null && !Number.isInteger(d.maxPayloadLbs)) errors.maxPayloadLbs = 'Use whole pounds';
      if (d.hasCdl && !d.cdlClass) errors.cdlClass = 'Pick your CDL class';
      if (d.truckDescription.trim().length > LIMITS.truckDescription.max) {
        errors.truckDescription = `Keep it under ${LIMITS.truckDescription.max} characters`;
      }
      const mc = cleanAuthorityNumber(d.mcNumber);
      if (mc && !new RegExp(`^\\d{1,${LIMITS.mcNumber.max}}$`).test(mc)) {
        errors.mcNumber = `MC number is up to ${LIMITS.mcNumber.max} digits`;
      }
      const dot = cleanAuthorityNumber(d.dotNumber);
      if (dot && !new RegExp(`^\\d{1,${LIMITS.dotNumber.max}}$`).test(dot)) {
        errors.dotNumber = `USDOT number is up to ${LIMITS.dotNumber.max} digits`;
      }
      break;
    }
    case 'location':
      if (!d.currentCity) errors.currentCityId = 'Pick the city where you are, or will be, empty';
      if (d.availability === 'later') {
        if (!d.availableFrom) errors.availableFrom = 'Pick when you’ll be empty';
        else if (Date.parse(d.availableFrom) <= now.getTime()) errors.availableFrom = 'That time has passed. Pick “Empty now” or a later time';
      }
      break;
    case 'preferences':
      checkRange(errors, 'maxDeadheadMiles', d.maxDeadheadMiles, 'Enter your max deadhead', (a, b) => `Deadhead runs ${a} to ${b} mi`);
      checkRange(errors, 'minRatePerMile', d.minRatePerMile, 'Enter your minimum rate (0 is fine)', (a, b) => `Use $${a} to $${b} per mile`);
      checkRange(errors, 'mpg', d.mpg, 'Enter your fuel economy', (a, b) => `Fuel economy runs ${a} to ${b} mpg`);
      checkRange(errors, 'fuelPricePerGallon', d.fuelPricePerGallon, 'Enter a diesel price', (a, b) => `Use $${a} to $${b} a gallon`);
      if (d.maxDeadheadMiles !== null && !Number.isInteger(d.maxDeadheadMiles)) errors.maxDeadheadMiles = 'Use whole miles';
      break;
  }
  return errors;
}

export function validateAll(d: ProfileDraft, now: Date = new Date()): ProfileErrors {
  return Object.assign({}, ...SECTION_ORDER.map((s) => validateSection(s, d, now))) as ProfileErrors;
}

export function hasErrors(errors: ProfileErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Field errors from a 400 response, keyed like ProfileErrors ("preferredStates.2" -> preferredStates). */
export function errorsFromApi(err: ApiError): ProfileErrors {
  const out: ProfileErrors = {};
  for (const [path, message] of Object.entries(err.fieldErrors())) {
    const field = path.split('.')[0] as keyof DriverProfileUpdate;
    if (!out[field]) out[field] = message;
  }
  return out;
}

/** The first section (in wizard order) that has an error, so the wizard can jump back to it. */
export function firstSectionWithError(errors: ProfileErrors): SectionId | null {
  for (const section of SECTION_ORDER) {
    if (SECTION_FIELDS[section].some((f) => errors[f])) return section;
  }
  return null;
}

/**
 * Switch rig type. Equipment from the other class is dropped (the API rejects it), and values
 * still at the old class's defaults move to the new class's defaults. Semi freight always needs
 * a CDL, so a non-CDL driver switching to semi starts with Class A selected.
 */
export function changeDriverClass(d: ProfileDraft, next: DriverClass): ProfileDraft {
  if (next === d.driverClass) return d;
  const prevCapacity = CLASS_CAPACITY[d.driverClass];
  const prevPrefs = DRIVER_CLASSES[d.driverClass];
  const nextPrefs = DRIVER_CLASSES[next];
  const capacityIsDefault =
    d.trailerLengthFt === prevCapacity.trailerLengthFt && d.maxPayloadLbs === prevCapacity.maxPayloadLbs;
  const toSemiWithoutCdl = next === 'semi' && !d.hasCdl;
  return {
    ...d,
    driverClass: next,
    equipmentTypes: d.equipmentTypes.filter((c) => equipmentForClass(next).includes(c)),
    ...(capacityIsDefault ? CLASS_CAPACITY[next] : {}),
    hasCdl: toSemiWithoutCdl ? true : d.hasCdl,
    cdlClass: toSemiWithoutCdl ? 'A' : d.cdlClass,
    mpg: d.mpg === prevPrefs.defaultMpg ? nextPrefs.defaultMpg : d.mpg,
    maxDeadheadMiles: d.maxDeadheadMiles === prevPrefs.defaultMaxDeadheadMiles ? nextPrefs.defaultMaxDeadheadMiles : d.maxDeadheadMiles,
    minRatePerMile: d.minRatePerMile === prevPrefs.defaultMinRatePerMile ? nextPrefs.defaultMinRatePerMile : d.minRatePerMile,
  };
}

export interface CapacitySuggestion {
  trailerLengthFt: number;
  maxPayloadLbs: number;
  /** True when the payload was held to the non-CDL hotshot ceiling. */
  cappedForNonCdl: boolean;
  /** Short name of the setup the numbers come from ("gooseneck"). */
  basis: string;
}

/**
 * Typical deck and payload for the picked equipment (the largest setup wins, since the driver
 * can take freight for any of them). A non-CDL hotshot is held to the 10,000 lb ceiling.
 */
export function suggestCapacity(d: Pick<ProfileDraft, 'driverClass' | 'equipmentTypes' | 'hasCdl'>): CapacitySuggestion | null {
  const infos = d.equipmentTypes.map((c) => EQUIPMENT[c]).filter(Boolean);
  if (infos.length === 0) return null;
  const longest = infos.reduce((a, b) => (b.typicalLengthFt > a.typicalLengthFt ? b : a));
  const heaviest = infos.reduce((a, b) => (b.typicalPayloadLbs > a.typicalPayloadLbs ? b : a));
  const cap = d.driverClass === 'hotshot' && !d.hasCdl && heaviest.typicalPayloadLbs > NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS;
  return {
    trailerLengthFt: longest.typicalLengthFt,
    maxPayloadLbs: cap ? NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS : heaviest.typicalPayloadLbs,
    cappedForNonCdl: cap,
    basis: infos.length === 1 ? infos[0].shortLabel.toLowerCase() : 'your setups',
  };
}

/** Fuel cost per mile for the profit estimates, or null until both numbers are valid. */
export function fuelCostPerMile(d: Pick<ProfileDraft, 'mpg' | 'fuelPricePerGallon'>): number | null {
  if (!d.mpg || !d.fuelPricePerGallon || d.mpg < LIMITS.mpg.min) return null;
  return d.fuelPricePerGallon / d.mpg;
}
