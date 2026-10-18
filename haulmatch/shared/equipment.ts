import type { DriverClass, Endorsement, EquipmentCode } from './types';

export interface EquipmentInfo {
  code: EquipmentCode;
  label: string;
  shortLabel: string;
  driverClass: DriverClass;
  description: string;
  /** Typical deck/box length for this setup, used as a profile default. */
  typicalLengthFt: number;
  /** Typical legal payload for this setup, used as a profile default. */
  typicalPayloadLbs: number;
  requiresEndorsement?: Endorsement;
  /**
   * Demo market benchmark, all-in spot USD per loaded mile. These are illustrative
   * figures for matching and rate suggestions, not live market data.
   */
  benchmarkRatePerMile: number;
  /** Lowest all-in charge a carrier typically accepts for a short run with this equipment. */
  minimumChargeUsd: number;
}

export const EQUIPMENT: Record<EquipmentCode, EquipmentInfo> = {
  HS_GOOSENECK: {
    code: 'HS_GOOSENECK',
    label: 'Hotshot gooseneck flatbed',
    shortLabel: 'Gooseneck',
    driverClass: 'hotshot',
    description: '1-ton dually pulling a 30–40 ft gooseneck flatbed. The standard hotshot setup.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 16_500,
    benchmarkRatePerMile: 1.85,
    minimumChargeUsd: 300,
  },
  HS_BUMPER_PULL: {
    code: 'HS_BUMPER_PULL',
    label: 'Hotshot bumper-pull flatbed',
    shortLabel: 'Bumper pull',
    driverClass: 'hotshot',
    description: 'Pickup with a 20–32 ft tag-along flatbed. Lighter, shorter freight.',
    typicalLengthFt: 25,
    typicalPayloadLbs: 9_000,
    benchmarkRatePerMile: 1.7,
    minimumChargeUsd: 250,
  },
  HS_DOVETAIL: {
    code: 'HS_DOVETAIL',
    label: 'Hotshot dovetail with ramps',
    shortLabel: 'Dovetail',
    driverClass: 'hotshot',
    description: 'Gooseneck with a dovetail and ramps for equipment you drive or winch on.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 15_000,
    benchmarkRatePerMile: 1.95,
    minimumChargeUsd: 325,
  },
  HS_CAR_HAULER: {
    code: 'HS_CAR_HAULER',
    label: 'Hotshot car hauler (wedge)',
    shortLabel: 'Car hauler',
    driverClass: 'hotshot',
    description: 'Wedge or 3-car gooseneck trailer for vehicles.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 12_000,
    benchmarkRatePerMile: 1.9,
    minimumChargeUsd: 300,
  },
  DRY_VAN: {
    code: 'DRY_VAN',
    label: "Dry van (53')",
    shortLabel: 'Dry van',
    driverClass: 'semi',
    description: 'Enclosed 53 ft trailer for palletized and boxed freight.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 45_000,
    benchmarkRatePerMile: 2.1,
    minimumChargeUsd: 450,
  },
  REEFER: {
    code: 'REEFER',
    label: "Reefer (53')",
    shortLabel: 'Reefer',
    driverClass: 'semi',
    description: 'Temperature-controlled 53 ft trailer.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 43_500,
    benchmarkRatePerMile: 2.45,
    minimumChargeUsd: 500,
  },
  FLATBED: {
    code: 'FLATBED',
    label: "Flatbed (48')",
    shortLabel: 'Flatbed',
    driverClass: 'semi',
    description: '48 ft open deck for steel, lumber, machinery and building materials.',
    typicalLengthFt: 48,
    typicalPayloadLbs: 48_000,
    benchmarkRatePerMile: 2.55,
    minimumChargeUsd: 500,
  },
  STEP_DECK: {
    code: 'STEP_DECK',
    label: "Step deck (53')",
    shortLabel: 'Step deck',
    driverClass: 'semi',
    description: 'Drop deck for taller freight that will not clear on a flatbed.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 46_000,
    benchmarkRatePerMile: 2.75,
    minimumChargeUsd: 550,
  },
  RGN: {
    code: 'RGN',
    label: 'RGN / lowboy',
    shortLabel: 'RGN',
    driverClass: 'semi',
    description: 'Removable gooseneck lowboy for heavy and oversize equipment.',
    typicalLengthFt: 48,
    typicalPayloadLbs: 42_000,
    benchmarkRatePerMile: 3.6,
    minimumChargeUsd: 800,
  },
  CONESTOGA: {
    code: 'CONESTOGA',
    label: 'Conestoga',
    shortLabel: 'Conestoga',
    driverClass: 'semi',
    description: 'Flatbed with a rolling tarp system for freight that must stay covered.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 44_000,
    benchmarkRatePerMile: 2.9,
    minimumChargeUsd: 550,
  },
  TANKER: {
    code: 'TANKER',
    label: 'Tanker',
    shortLabel: 'Tanker',
    driverClass: 'semi',
    description: 'Liquid or dry bulk tank trailer. Requires the tanker (N) endorsement.',
    typicalLengthFt: 45,
    typicalPayloadLbs: 45_000,
    requiresEndorsement: 'tanker',
    benchmarkRatePerMile: 2.95,
    minimumChargeUsd: 600,
  },
  POWER_ONLY: {
    code: 'POWER_ONLY',
    label: 'Power only',
    shortLabel: 'Power only',
    driverClass: 'semi',
    description: 'Tractor only. Hooks to the shipper’s preloaded trailer.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 45_000,
    benchmarkRatePerMile: 1.9,
    minimumChargeUsd: 400,
  },
};

export const EQUIPMENT_CODES = Object.keys(EQUIPMENT) as EquipmentCode[];
export const HOTSHOT_EQUIPMENT = EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].driverClass === 'hotshot');
export const SEMI_EQUIPMENT = EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].driverClass === 'semi');

export function equipmentForClass(driverClass: DriverClass): EquipmentCode[] {
  return driverClass === 'hotshot' ? HOTSHOT_EQUIPMENT : SEMI_EQUIPMENT;
}

export function isEquipmentCode(value: string): value is EquipmentCode {
  return Object.prototype.hasOwnProperty.call(EQUIPMENT, value);
}

/**
 * Non-CDL hotshot payload ceiling. A Class A CDL is needed once the combination is rated
 * 26,001+ lbs with a towed unit over 10,000 lbs; a 1-ton dually and gooseneck weigh roughly
 * 15,000 lbs empty, so a non-CDL hotshot can carry about 10,000 lbs before crossing that line.
 */
export const NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS = 10_000;

/** The largest load a typical hotshot rig can take; used to flag "hotshot-friendly" freight. */
export const HOTSHOT_MAX_LENGTH_FT = 40;
export const HOTSHOT_MAX_PAYLOAD_LBS = 16_500;

export interface DriverClassInfo {
  driverClass: DriverClass;
  label: string;
  description: string;
  defaultMpg: number;
  defaultMaxDeadheadMiles: number;
  defaultMinRatePerMile: number;
}

export const DRIVER_CLASSES: Record<DriverClass, DriverClassInfo> = {
  hotshot: {
    driverClass: 'hotshot',
    label: 'Hotshot',
    description: 'Pickup and flatbed or gooseneck trailer. Fast, smaller, time-critical freight.',
    defaultMpg: 11,
    defaultMaxDeadheadMiles: 150,
    defaultMinRatePerMile: 1.5,
  },
  semi: {
    driverClass: 'semi',
    label: 'Semi',
    description: 'Class 8 tractor-trailer. Full truckload and heavy freight.',
    defaultMpg: 6.5,
    defaultMaxDeadheadMiles: 200,
    defaultMinRatePerMile: 1.9,
  },
};

export const DEFAULT_FUEL_PRICE_PER_GALLON = 3.75;
