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
   * Market benchmark, all-in spot USD per loaded mile (fuel included), as of MARKET_SNAPSHOT.
   * Dry van, reefer and flatbed are DAT's national spot averages (benchmarkFromDat); the rest are
   * estimates derived from them. Used for matching and rate suggestions; not live data.
   */
  benchmarkRatePerMile: number;
  /** True when benchmarkRatePerMile is DAT's published national average, not a derived estimate. */
  benchmarkFromDat?: boolean;
  /** Lowest all-in charge a carrier typically accepts for a short run with this equipment. */
  minimumChargeUsd: number;
}

/**
 * When the rate benchmarks were last set and where they come from. DAT's September 2026 national
 * spot averages (fuel included): dry van $3.01/mi, reefer $3.62/mi, flatbed $3.61/mi, with record
 * fuel shares (van $0.84, reefer $0.92, flatbed $1.01 per mile). EIA's weekly on-highway diesel
 * averaged $6.29/gal over September 2026 (weekly record $6.53 on Sep 21). Hotshot, step deck, RGN,
 * Conestoga, tanker, dry bulk and power-only figures are estimates scaled from those averages.
 * Update every figure together, and asOf with them, when the market moves.
 */
export const MARKET_SNAPSHOT = {
  /** Year and month the benchmarks describe (YYYY-MM). */
  asOf: '2026-09',
  label: 'DAT national spot averages, Sept 2026 (fuel included)',
  dieselUsdPerGallon: 6.29,
} as const;

export const EQUIPMENT: Record<EquipmentCode, EquipmentInfo> = {
  HS_GOOSENECK: {
    code: 'HS_GOOSENECK',
    label: 'Hotshot gooseneck flatbed',
    shortLabel: 'Gooseneck',
    driverClass: 'hotshot',
    description: '1-ton dually pulling a 30–40 ft gooseneck flatbed. The standard hotshot setup.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 16_500,
    benchmarkRatePerMile: 2.4,
    minimumChargeUsd: 400,
  },
  HS_BUMPER_PULL: {
    code: 'HS_BUMPER_PULL',
    label: 'Hotshot bumper-pull flatbed',
    shortLabel: 'Bumper pull',
    driverClass: 'hotshot',
    description: 'Pickup with a 20–32 ft tag-along flatbed. Lighter, shorter freight.',
    typicalLengthFt: 25,
    typicalPayloadLbs: 9_000,
    benchmarkRatePerMile: 2.2,
    minimumChargeUsd: 325,
  },
  HS_DOVETAIL: {
    code: 'HS_DOVETAIL',
    label: 'Hotshot dovetail with ramps',
    shortLabel: 'Dovetail',
    driverClass: 'hotshot',
    description: 'Gooseneck with a dovetail and ramps for equipment you drive or winch on.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 15_000,
    benchmarkRatePerMile: 2.5,
    minimumChargeUsd: 425,
  },
  HS_CAR_HAULER: {
    code: 'HS_CAR_HAULER',
    label: 'Hotshot car hauler (wedge)',
    shortLabel: 'Car hauler',
    driverClass: 'hotshot',
    description: '2- or 3-car wedge or gooseneck trailer for vehicles.',
    typicalLengthFt: 40,
    typicalPayloadLbs: 12_000,
    benchmarkRatePerMile: 2.45,
    minimumChargeUsd: 375,
  },
  DRY_VAN: {
    code: 'DRY_VAN',
    label: "Dry van (53')",
    shortLabel: 'Dry van',
    driverClass: 'semi',
    description: 'Enclosed 53 ft trailer for palletized and boxed freight.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 45_000,
    benchmarkRatePerMile: 3.01,
    benchmarkFromDat: true,
    minimumChargeUsd: 650,
  },
  REEFER: {
    code: 'REEFER',
    label: "Reefer (53')",
    shortLabel: 'Reefer',
    driverClass: 'semi',
    description: 'Temperature-controlled 53 ft trailer.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 43_500,
    benchmarkRatePerMile: 3.62,
    benchmarkFromDat: true,
    minimumChargeUsd: 750,
  },
  FLATBED: {
    code: 'FLATBED',
    label: "Flatbed (48')",
    shortLabel: 'Flatbed',
    driverClass: 'semi',
    description: '48 ft open deck for steel, lumber, machinery and building materials.',
    typicalLengthFt: 48,
    typicalPayloadLbs: 48_000,
    benchmarkRatePerMile: 3.61,
    benchmarkFromDat: true,
    minimumChargeUsd: 700,
  },
  STEP_DECK: {
    code: 'STEP_DECK',
    label: "Step deck (53')",
    shortLabel: 'Step deck',
    driverClass: 'semi',
    description: 'Drop deck for taller freight that will not clear on a flatbed.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 46_000,
    benchmarkRatePerMile: 3.85,
    minimumChargeUsd: 775,
  },
  RGN: {
    code: 'RGN',
    label: 'RGN / lowboy',
    shortLabel: 'RGN',
    driverClass: 'semi',
    description: 'Removable gooseneck lowboy for heavy and oversize equipment.',
    typicalLengthFt: 48,
    typicalPayloadLbs: 42_000,
    benchmarkRatePerMile: 4.75,
    minimumChargeUsd: 1_050,
  },
  CONESTOGA: {
    code: 'CONESTOGA',
    label: 'Conestoga',
    shortLabel: 'Conestoga',
    driverClass: 'semi',
    description: 'Flatbed with a rolling tarp system for freight that must stay covered.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 44_000,
    benchmarkRatePerMile: 3.9,
    minimumChargeUsd: 750,
  },
  TANKER: {
    code: 'TANKER',
    label: 'Tanker',
    shortLabel: 'Tanker',
    driverClass: 'semi',
    description: 'Liquid or gas tank trailer. Requires the tanker (N) endorsement.',
    typicalLengthFt: 45,
    typicalPayloadLbs: 45_000,
    requiresEndorsement: 'tanker',
    benchmarkRatePerMile: 3.8,
    minimumChargeUsd: 775,
  },
  DRY_BULK: {
    code: 'DRY_BULK',
    label: 'Dry bulk (pneumatic)',
    shortLabel: 'Dry bulk',
    driverClass: 'semi',
    description: 'Pneumatic tank for frac sand, cement and other dry bulk. No tanker (N) endorsement needed.',
    typicalLengthFt: 45,
    typicalPayloadLbs: 48_000,
    // Priced like a tanker: specialised equipment, mostly one-way runs.
    benchmarkRatePerMile: 3.8,
    minimumChargeUsd: 775,
  },
  POWER_ONLY: {
    code: 'POWER_ONLY',
    label: 'Power only',
    shortLabel: 'Power only',
    driverClass: 'semi',
    description: 'Tractor only. Hooks to the shipper’s preloaded trailer.',
    typicalLengthFt: 53,
    typicalPayloadLbs: 45_000,
    benchmarkRatePerMile: 2.7,
    minimumChargeUsd: 575,
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
 * Non-CDL hotshot payload ceiling. A Class A CDL is needed once the combination is rated (or
 * weighs) 26,001+ lbs with a towed unit over 10,000 lbs (49 CFR 383.91). A 1-ton dually and
 * gooseneck weigh roughly 15,000 lbs empty, so a non-CDL rig carries about 10,000 lbs.
 */
export const NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS = 10_000;

/**
 * The largest load a typical CDL hotshot rig can take (40 ft is the most common gooseneck deck);
 * used to flag "hotshot-friendly" freight.
 */
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
    defaultMinRatePerMile: 1.85,
  },
  semi: {
    driverClass: 'semi',
    label: 'Semi',
    description: 'Class 8 tractor-trailer. Full truckload and heavy freight.',
    defaultMpg: 6.5,
    defaultMaxDeadheadMiles: 200,
    defaultMinRatePerMile: 2.4,
  },
};

/** Starting diesel price for new driver profiles: the latest national average in MARKET_SNAPSHOT. */
export const DEFAULT_FUEL_PRICE_PER_GALLON: number = MARKET_SNAPSHOT.dieselUsdPerGallon;
