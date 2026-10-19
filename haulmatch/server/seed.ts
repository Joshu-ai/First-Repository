// Deterministic demo data: three demo logins, a few more shippers and drivers, ~160 open loads on
// real freight corridors, and enough history (bookings, requests, messages, alerts) to demo every screen.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { placeForCityId } from '../shared/cities';
import {
  DEFAULT_FUEL_PRICE_PER_GALLON,
  DRIVER_CLASSES,
  EQUIPMENT,
  HOTSHOT_MAX_LENGTH_FT,
  HOTSHOT_MAX_PAYLOAD_LBS,
} from '../shared/equipment';
import { roadMiles, transitHours } from '../shared/geo';
import { compareMatches, matchLoad, type MatchableLoad } from '../shared/matching';
import { estimateRate } from '../shared/rates';
import type {
  BookingMode,
  BookingStatus,
  DriverClass,
  DriverProfile,
  Endorsement,
  EquipmentCode,
  LoadSearchFilters,
  LoadSize,
  LoadStatus,
  MatchResult,
  NotificationType,
  Place,
} from '../shared/types';
import { hashPasswordSync } from './auth';
import { bool, openDb, transaction, type Db } from './db';
import { loadPassesFilters } from './filters';
import { getDriverProfile, getLoadById } from './mappers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
/** Changing this reshuffles every generated load, so keep it fixed. */
const SEED = 0x4a17c0de;

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_EMAILS = {
  hotshot: 'hotshot@demo.haulmatch.app',
  semi: 'semi@demo.haulmatch.app',
  shipper: 'shipper@demo.haulmatch.app',
} as const;

export interface SeedSummary {
  users: number;
  drivers: number;
  shippers: number;
  loads: number;
  openLoads: number;
  bookings: number;
  pendingRequests: number;
  messages: number;
  notifications: number;
  savedSearches: number;
}

// ---- Deterministic randomness ----

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: tiny, fast and identical on every platform, which is all demo data needs. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** RFC 4122 v4-shaped id drawn from this stream, so reseeding reproduces every id. */
  uuid(): string {
    const hex = Array.from({ length: 16 }, (_, i) => {
      let byte = Math.floor(this.next() * 256);
      if (i === 6) byte = (byte & 0x0f) | 0x40;
      if (i === 8) byte = (byte & 0x3f) | 0x80;
      return byte.toString(16).padStart(2, '0');
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

// ---- Geography: where the freight actually moves ----

type CityList = readonly string[];

const PERMIAN: CityList = [
  'odessa-tx', 'midland-tx', 'pecos-tx', 'monahans-tx', 'kermit-tx', 'andrews-tx', 'big-spring-tx',
  'fort-stockton-tx', 'lamesa-tx', 'seminole-tx', 'hobbs-nm', 'carlsbad-nm', 'artesia-nm', 'lovington-nm',
];
const EAGLE_FORD: CityList = [
  'cotulla-tx', 'pleasanton-tx', 'kenedy-tx', 'alice-tx', 'carrizo-springs-tx', 'karnes-city-tx', 'pearsall-tx',
  'dilley-tx', 'beeville-tx', 'kingsville-tx',
];
const SOUTH_TX: CityList = ['san-antonio-tx', 'laredo-tx', 'victoria-tx', 'corpus-christi-tx'];
const HOUSTON_SUPPLY: CityList = ['houston-tx', 'pasadena-tx', 'baytown-tx', 'conroe-tx', 'sugar-land-tx'];
const GULF_TX: CityList = ['beaumont-tx', 'port-arthur-tx', 'bay-city-tx', 'freeport-tx'];
const GULF_LA: CityList = [
  'houma-la', 'morgan-city-la', 'new-iberia-la', 'thibodaux-la', 'lafayette-la', 'lake-charles-la', 'sulphur-la',
  'baton-rouge-la',
];
const HAYNESVILLE: CityList = [
  'shreveport-la', 'carthage-tx', 'marshall-tx', 'longview-tx', 'henderson-tx', 'kilgore-tx', 'mansfield-la',
  'tyler-tx',
];
const ANADARKO: CityList = [
  'elk-city-ok', 'woodward-ok', 'chickasha-ok', 'weatherford-ok', 'clinton-ok', 'duncan-ok', 'el-reno-ok', 'enid-ok',
  'guymon-ok', 'ardmore-ok', 'pampa-tx',
];
const OK_HUBS: CityList = ['oklahoma-city-ok', 'tulsa-ok', 'lawton-ok', 'wichita-falls-tx', 'amarillo-tx'];
const BAKKEN: CityList = ['williston-nd', 'watford-city-nd', 'dickinson-nd', 'minot-nd', 'sidney-mt', 'glendive-mt'];
const NORTHERN_HUBS: CityList = ['bismarck-nd', 'mandan-nd', 'billings-mt', 'fargo-nd', 'casper-wy', 'rapid-city-sd'];
const ROCKIES: CityList = [
  'gillette-wy', 'casper-wy', 'rock-springs-wy', 'rawlins-wy', 'sheridan-wy', 'douglas-wy', 'laramie-wy', 'vernal-ut',
  'farmington-nm', 'grand-junction-co',
];
const DJ_BASIN: CityList = ['greeley-co', 'fort-morgan-co', 'sterling-co', 'denver-co', 'cheyenne-wy'];
const MARCELLUS: CityList = ['pittsburgh-pa', 'washington-pa', 'williamsport-pa'];
const PLAINS_AG: CityList = [
  'dodge-city-ks', 'garden-city-ks', 'liberal-ks', 'hays-ks', 'great-bend-ks', 'hastings-ne', 'north-platte-ne',
  'scottsbluff-ne', 'kearney-ne', 'grand-island-ne', 'mason-city-ia', 'fort-dodge-ia', 'watertown-sd', 'aberdeen-sd',
  'jamestown-nd', 'guymon-ok',
];
const AG_DEALERS: CityList = [
  'wichita-ks', 'salina-ks', 'hutchinson-ks', 'lincoln-ne', 'omaha-ne', 'des-moines-ia', 'sioux-falls-sd',
  'sioux-city-ia', 'fargo-nd', 'kansas-city-mo', 'amarillo-tx', 'lubbock-tx',
];
const WEST_TX_AG: CityList = [
  'lubbock-tx', 'amarillo-tx', 'abilene-tx', 'san-angelo-tx', 'lamesa-tx', 'snyder-tx', 'sweetwater-tx', 'pampa-tx',
  'clovis-nm', 'big-spring-tx',
];
const HAY_COUNTRY: CityList = [
  'north-platte-ne', 'scottsbluff-ne', 'hays-ks', 'dodge-city-ks', 'sheridan-wy', 'kearney-ne', 'hastings-ne',
];
const HAY_BUYERS: CityList = [
  'amarillo-tx', 'lubbock-tx', 'fort-worth-tx', 'oklahoma-city-ok', 'san-angelo-tx', 'abilene-tx', 'wichita-falls-tx',
  'woodward-ok',
];
const TX_METROS: CityList = ['dallas-tx', 'fort-worth-tx', 'houston-tx', 'san-antonio-tx', 'austin-tx', 'el-paso-tx'];
const SOUTHWEST_METROS: CityList = [
  'phoenix-az', 'tucson-az', 'albuquerque-nm', 'denver-co', 'oklahoma-city-ok', 'tulsa-ok', 'las-vegas-nv',
];
const SOUTHEAST_METROS: CityList = [
  'atlanta-ga', 'nashville-tn', 'memphis-tn', 'birmingham-al', 'charlotte-nc', 'jacksonville-fl',
];
const SOUTH_CENTRAL: CityList = [
  'austin-tx', 'san-antonio-tx', 'houston-tx', 'dallas-tx', 'oklahoma-city-ok', 'tulsa-ok', 'little-rock-ar',
  'shreveport-la', 'albuquerque-nm', 'amarillo-tx', 'lubbock-tx', 'odessa-tx', 'new-orleans-la', 'memphis-tn',
  'jackson-ms', 'birmingham-al', 'baton-rouge-la', 'el-paso-tx', 'wichita-ks', 'kansas-city-mo',
];
const NATIONAL_DC: CityList = [
  'dallas-tx', 'houston-tx', 'atlanta-ga', 'chicago-il', 'memphis-tn', 'nashville-tn', 'indianapolis-in',
  'columbus-oh', 'kansas-city-mo', 'st-louis-mo', 'denver-co', 'phoenix-az', 'los-angeles-ca', 'ontario-ca',
  'salt-lake-city-ut', 'charlotte-nc', 'jacksonville-fl', 'orlando-fl', 'birmingham-al', 'little-rock-ar',
  'louisville-ky', 'harrisburg-pa', 'allentown-pa', 'newark-nj', 'baltimore-md', 'minneapolis-mn', 'laredo-tx',
  'el-paso-tx', 'oklahoma-city-ok', 'san-antonio-tx', 'savannah-ga', 'riverside-ca', 'stockton-ca', 'reno-nv',
  'seattle-wa', 'portland-or', 'milwaukee-wi', 'detroit-mi', 'cincinnati-oh', 'richmond-va',
];
const BORDER: CityList = [
  'laredo-tx', 'eagle-pass-tx', 'del-rio-tx', 'el-paso-tx', 'pharr-tx', 'nogales-az', 'calexico-ca',
];
const VALLEY_PRODUCE: CityList = ['mcallen-tx', 'pharr-tx', 'laredo-tx', 'eagle-pass-tx', 'edinburg-tx'];
const STEEL_MILLS: CityList = [
  'houston-tx', 'birmingham-al', 'chicago-il', 'gary-in', 'pittsburgh-pa', 'fort-worth-tx', 'tulsa-ok', 'beaumont-tx',
];
const LUMBER_MILLS: CityList = [
  'lufkin-tx', 'shreveport-la', 'monroe-la', 'alexandria-la', 'jackson-ms', 'hattiesburg-ms',
];
const CHEM_PLANTS: CityList = [
  'houston-tx', 'pasadena-tx', 'baytown-tx', 'beaumont-tx', 'port-arthur-tx', 'lake-charles-la', 'freeport-tx',
  'corpus-christi-tx', 'baton-rouge-la',
];
const EQUIPMENT_DEALERS: CityList = [
  'houston-tx', 'dallas-tx', 'fort-worth-tx', 'denver-co', 'des-moines-ia', 'kansas-city-mo', 'omaha-ne',
  'oklahoma-city-ok', 'peoria-il', 'phoenix-az', 'san-antonio-tx',
];
const BEEF_PLANTS: CityList = [
  'dodge-city-ks', 'garden-city-ks', 'liberal-ks', 'amarillo-tx', 'grand-island-ne', 'sioux-city-ia',
];
/** Where the demo semi's flatbed cluster goes: short and medium hauls out of DFW. */
const DFW_OUTBOUND: CityList = [
  ...SOUTH_CENTRAL, 'midland-tx', 'pecos-tx', 'carthage-tx', 'elk-city-ok', 'laredo-tx', 'corpus-christi-tx',
  'denver-co', 'atlanta-ga',
];
const DFW_AREA: CityList = [
  'dallas-tx', 'fort-worth-tx', 'arlington-tx', 'irving-tx', 'garland-tx', 'mckinney-tx', 'denton-tx', 'waco-tx',
  'tyler-tx', 'sherman-tx', 'weatherford-tx', 'temple-tx', 'longview-tx', 'wichita-falls-tx',
];
/** Where the demo hotshot's Permian cluster goes. */
const PERMIAN_OUTBOUND: CityList = [
  ...PERMIAN, 'san-angelo-tx', 'snyder-tx', 'sweetwater-tx', 'lubbock-tx', 'abilene-tx', 'el-paso-tx', 'roswell-nm',
  'albuquerque-nm', 'san-antonio-tx', 'houston-tx', 'fort-worth-tx', 'oklahoma-city-ok', 'amarillo-tx', 'pleasanton-tx',
  'cotulla-tx',
];

interface Lane {
  weight: number;
  from: CityList;
  to: CityList;
}

const lane = (weight: number, from: CityList, to: CityList): Lane => ({ weight, from, to });

const OILFIELD_LANES: Lane[] = [
  lane(5, HOUSTON_SUPPLY, PERMIAN),
  lane(4, PERMIAN, PERMIAN),
  lane(1.5, PERMIAN, [...EAGLE_FORD, ...SOUTH_TX]),
  lane(3, [...HOUSTON_SUPPLY, ...SOUTH_TX], EAGLE_FORD),
  lane(1.5, EAGLE_FORD, [...EAGLE_FORD, ...SOUTH_TX]),
  lane(3, [...HOUSTON_SUPPLY, ...GULF_TX], GULF_LA),
  lane(2.5, GULF_LA, [...GULF_LA, ...HOUSTON_SUPPLY]),
  lane(2, [...HOUSTON_SUPPLY, 'dallas-tx', 'fort-worth-tx'], HAYNESVILLE),
  lane(1.5, HAYNESVILLE, [...HAYNESVILLE, ...GULF_LA]),
  lane(3, [...OK_HUBS, 'dallas-tx', 'fort-worth-tx'], ANADARKO),
  lane(2, ANADARKO, [...ANADARKO, ...OK_HUBS, ...PERMIAN]),
  lane(2.5, NORTHERN_HUBS, BAKKEN),
  lane(2, BAKKEN, [...BAKKEN, ...NORTHERN_HUBS]),
  lane(1.5, [...DJ_BASIN, 'casper-wy'], ROCKIES),
  lane(
    1,
    [...PERMIAN, 'el-paso-tx', 'albuquerque-nm'],
    ['farmington-nm', 'roswell-nm', 'hobbs-nm', 'carlsbad-nm', 'artesia-nm'],
  ),
  lane(0.7, MARCELLUS, MARCELLUS),
];
const AG_LANES: Lane[] = [
  lane(4, AG_DEALERS, PLAINS_AG),
  lane(2, PLAINS_AG, PLAINS_AG),
  lane(1.5, PLAINS_AG, AG_DEALERS),
  lane(1.5, WEST_TX_AG, WEST_TX_AG),
];
const HAY_LANES: Lane[] = [lane(3, HAY_COUNTRY, HAY_BUYERS), lane(1, PLAINS_AG, PLAINS_AG)];
const CONSTRUCTION_LANES: Lane[] = [
  lane(3, TX_METROS, [...TX_METROS, ...OK_HUBS, 'waco-tx', 'tyler-tx', 'lubbock-tx']),
  lane(2, ['dallas-tx', 'fort-worth-tx', 'houston-tx', 'san-antonio-tx'], PERMIAN),
  lane(2, SOUTHWEST_METROS, [...SOUTHWEST_METROS, 'flagstaff-az', 'kingman-az', 'gallup-nm', 'grand-junction-co']),
  lane(1, SOUTHEAST_METROS, SOUTHEAST_METROS),
  lane(1, ['denver-co', 'greeley-co'], [...DJ_BASIN, 'laramie-wy', 'pueblo-co', 'colorado-springs-co']),
];
const VEHICLE_HUBS: CityList = [...TX_METROS, 'oklahoma-city-ok', 'tulsa-ok', 'shreveport-la', 'little-rock-ar'];
const WEST_VEHICLE_HUBS: CityList = [
  'phoenix-az', 'las-vegas-nv', 'albuquerque-nm', 'denver-co', 'los-angeles-ca', 'tucson-az',
];
const VEHICLE_LANES: Lane[] = [
  lane(3, VEHICLE_HUBS, [...VEHICLE_HUBS, 'lubbock-tx', 'amarillo-tx']),
  lane(1.5, WEST_VEHICLE_HUBS, WEST_VEHICLE_HUBS),
];
const STEEL_LANES: Lane[] = [
  lane(3, STEEL_MILLS, [...TX_METROS, ...SOUTH_CENTRAL]), lane(1.5, STEEL_MILLS, NATIONAL_DC),
];
const LUMBER_LANES: Lane[] = [
  lane(
    3,
    LUMBER_MILLS,
    [...TX_METROS, 'phoenix-az', 'denver-co', 'oklahoma-city-ok', 'atlanta-ga', 'memphis-tn', 'albuquerque-nm'],
  ),
  lane(
    1,
    ['eugene-or', 'portland-or', 'spokane-wa'],
    ['phoenix-az', 'las-vegas-nv', 'salt-lake-city-ut', 'denver-co', 'los-angeles-ca', 'reno-nv'],
  ),
];
const CASING_LANES: Lane[] = [
  lane(3, HOUSTON_SUPPLY, [...PERMIAN, ...ANADARKO, ...EAGLE_FORD, ...HAYNESVILLE]),
  lane(1, ['houston-tx', 'tulsa-ok'], BAKKEN),
];
const BUILDING_LANES: Lane[] = [
  lane(3, ['dallas-tx', 'fort-worth-tx', 'houston-tx', 'san-antonio-tx', 'oklahoma-city-ok'], SOUTH_CENTRAL),
  lane(2, NATIONAL_DC, NATIONAL_DC),
];
const CYLINDER_LANES: Lane[] = [lane(1, CHEM_PLANTS, [...TX_METROS, ...SOUTH_CENTRAL, ...PERMIAN])];
const MACHINERY_LANES: Lane[] = [
  lane(3, EQUIPMENT_DEALERS, [...PERMIAN, ...ANADARKO, ...BAKKEN, ...EAGLE_FORD]),
  lane(2, EQUIPMENT_DEALERS, [...TX_METROS, ...SOUTHWEST_METROS]),
  lane(1, EQUIPMENT_DEALERS, ROCKIES),
];
const FARM_MACHINERY_LANES: Lane[] = [lane(3, AG_DEALERS, PLAINS_AG), lane(1, PLAINS_AG, AG_DEALERS)];
const OILFIELD_HEAVY_LANES: Lane[] = [
  lane(3, HOUSTON_SUPPLY, [...PERMIAN, ...EAGLE_FORD, ...HAYNESVILLE, ...ANADARKO]),
  lane(1, PERMIAN, [...PERMIAN, ...ANADARKO]),
];
const VAN_LANES: Lane[] = [lane(5, NATIONAL_DC, NATIONAL_DC), lane(2, BORDER, NATIONAL_DC)];
const CHEM_LANES: Lane[] = [
  lane(4, CHEM_PLANTS, [...TX_METROS, 'shreveport-la', 'memphis-tn', 'oklahoma-city-ok', 'tulsa-ok', 'little-rock-ar']),
];
const FRAC_ACID_LANES: Lane[] = [lane(1, CHEM_PLANTS, [...PERMIAN, ...EAGLE_FORD, ...ANADARKO])];
const CRUDE_LANES: Lane[] = [
  lane(2, PERMIAN, ['midland-tx', 'big-spring-tx', 'odessa-tx', 'corpus-christi-tx', 'houston-tx']),
  lane(1, EAGLE_FORD, ['corpus-christi-tx', 'victoria-tx', 'houston-tx']),
];
const POWER_LANES: Lane[] = [
  lane(1, ['dallas-tx', 'houston-tx', 'laredo-tx', 'memphis-tn', 'atlanta-ga', 'chicago-il'], NATIONAL_DC),
];
const toNationalDCs = (from: CityList): Lane[] => [lane(1, from, NATIONAL_DC)];

// ---- Freight: commodities and what they ride on ----

type GroupKey =
  | 'oilfield'
  | 'ag'
  | 'construction'
  | 'vehicles'
  | 'flatbed'
  | 'heavy'
  | 'van'
  | 'reefer'
  | 'tanker'
  | 'dryBulk'
  | 'powerOnly';

interface Freight {
  commodity: string;
  weight: [number, number];
  length: [number, number];
  lanes: Lane[];
  /** Posted equipment combinations. Omitted for hotshot freight, which derives them from its size. */
  equipment?: EquipmentCode[][];
  hazmat?: boolean;
  /** Chance the shipper requires tarps. */
  tarp?: number;
  /** Rolls or drives on, so it wants ramps (a dovetail) rather than a forklift. */
  driveOn?: boolean;
  /** Reefer set point. */
  tempF?: number;
}

const OILFIELD: Freight[] = [
  { commodity: 'Oilfield tubing, 2-7/8" joints', weight: [6_000, 16_000], length: [32, 40], lanes: OILFIELD_LANES },
  {
    commodity: 'Gate valves and wellhead parts (crated)', weight: [1_500, 8_000], length: [8, 20],
    lanes: OILFIELD_LANES,
  },
  { commodity: 'Frac pump fluid end', weight: [5_500, 11_000], length: [8, 14], lanes: OILFIELD_LANES },
  { commodity: 'Frac pump parts on pallets', weight: [2_500, 9_000], length: [10, 24], lanes: OILFIELD_LANES },
  { commodity: 'Frac iron and chiksans', weight: [4_000, 12_000], length: [16, 30], lanes: OILFIELD_LANES },
  { commodity: 'Steel tubing bundles', weight: [5_000, 15_000], length: [24, 40], tarp: 0.3, lanes: OILFIELD_LANES },
  { commodity: 'Generator, 150 kW skid-mounted', weight: [5_000, 9_800], length: [12, 18], lanes: OILFIELD_LANES },
  { commodity: 'Light towers (2)', weight: [5_000, 7_500], length: [20, 28], driveOn: true, lanes: OILFIELD_LANES },
  { commodity: 'Drill collars', weight: [9_000, 16_000], length: [30, 32], lanes: OILFIELD_LANES },
  { commodity: 'Frac tree and wellhead assembly', weight: [4_000, 9_500], length: [8, 12], lanes: OILFIELD_LANES },
  {
    commodity: 'Mud pump expendables (liners, pistons, valves)', weight: [1_500, 6_000], length: [8, 16],
    lanes: OILFIELD_LANES,
  },
  { commodity: 'Poly flowline pipe reels (3)', weight: [6_000, 12_000], length: [16, 24], lanes: OILFIELD_LANES },
  { commodity: 'Downhole motors and drill bits', weight: [3_000, 8_000], length: [24, 32], lanes: OILFIELD_LANES },
  {
    commodity: 'Propane cylinders (UN1075, Class 2.1)', weight: [3_000, 7_000], length: [12, 20], hazmat: true,
    lanes: OILFIELD_LANES,
  },
];

const AG: Freight[] = [
  { commodity: 'Round hay bales (24)', weight: [14_000, 16_500], length: [36, 40], lanes: HAY_LANES },
  { commodity: 'Small square hay bales', weight: [9_000, 16_000], length: [32, 40], tarp: 0.5, lanes: HAY_LANES },
  {
    commodity: 'Tillage implement, 30 ft folded', weight: [7_000, 13_000], length: [28, 38], driveOn: true,
    lanes: AG_LANES,
  },
  { commodity: 'Grain auger', weight: [3_000, 6_500], length: [32, 40], driveOn: true, lanes: AG_LANES },
  { commodity: 'Planter row units and parts', weight: [2_000, 6_000], length: [10, 20], lanes: AG_LANES },
  { commodity: 'Round baler', weight: [8_000, 10_500], length: [18, 22], driveOn: true, lanes: AG_LANES },
  { commodity: 'Cattle panels and pipe gates', weight: [4_000, 9_000], length: [20, 24], lanes: AG_LANES },
  { commodity: 'Center pivot irrigation parts', weight: [5_000, 11_000], length: [30, 40], lanes: AG_LANES },
  {
    commodity: 'Compact tractor with loader', weight: [5_000, 8_500], length: [14, 18], driveOn: true,
    lanes: AG_LANES,
  },
  { commodity: 'Steel fence posts and barbed wire', weight: [6_000, 12_000], length: [20, 24], lanes: AG_LANES },
  { commodity: 'Bagged seed on pallets', weight: [8_000, 15_000], length: [20, 28], tarp: 0.9, lanes: AG_LANES },
];

const CONSTRUCTION: Freight[] = [
  {
    commodity: 'Skid steer (Bobcat T770)', weight: [9_500, 10_500], length: [14, 16], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'Mini excavator (Kubota KX040)', weight: [9_200, 10_400], length: [18, 20], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'Compact track loader', weight: [8_500, 10_200], length: [13, 15], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'Scissor lifts (2)', weight: [5_000, 7_000], length: [16, 20], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'HVAC rooftop units (2)', weight: [3_000, 7_000], length: [12, 20], tarp: 0.5,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'Pallets of porcelain tile', weight: [6_000, 15_000], length: [16, 24], tarp: 0.6,
    lanes: CONSTRUCTION_LANES,
  },
  { commodity: 'Structural steel tubing', weight: [6_000, 14_000], length: [24, 40], lanes: CONSTRUCTION_LANES },
  {
    commodity: 'Zero-turn mowers (6)', weight: [4_200, 6_000], length: [20, 24], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
  {
    commodity: 'Roof trusses and lumber package', weight: [8_000, 15_000], length: [30, 40], tarp: 0.8,
    lanes: CONSTRUCTION_LANES,
  },
  { commodity: 'Rebar and wire mesh', weight: [8_000, 16_000], length: [20, 40], lanes: CONSTRUCTION_LANES },
  {
    commodity: 'Towable generator, 60 kW', weight: [3_500, 5_500], length: [14, 16], driveOn: true,
    lanes: CONSTRUCTION_LANES,
  },
];

const VEHICLES: Freight[] = [
  {
    commodity: '3 sedans (auction units)', weight: [9_000, 10_200], length: [40, 40], equipment: [['HS_CAR_HAULER']],
    lanes: VEHICLE_LANES,
  },
  {
    commodity: '2 pickups (F-250 and Silverado 2500)', weight: [11_000, 12_000], length: [40, 40],
    equipment: [['HS_CAR_HAULER']], lanes: VEHICLE_LANES,
  },
  {
    commodity: 'Classic car (1969 Camaro)',
    weight: [3_400, 3_800],
    length: [18, 20],
    equipment: [['HS_CAR_HAULER'], ['HS_CAR_HAULER', 'HS_DOVETAIL']],
    lanes: VEHICLE_LANES,
  },
  {
    commodity: 'Side-by-side UTVs (3)', weight: [4_500, 6_000], length: [30, 36],
    equipment: [['HS_CAR_HAULER', 'HS_DOVETAIL']], lanes: VEHICLE_LANES,
  },
  {
    commodity: 'Golf carts (8)',
    weight: [4_000, 6_000],
    length: [32, 40],
    equipment: [['HS_CAR_HAULER', 'HS_DOVETAIL', 'HS_GOOSENECK']],
    lanes: VEHICLE_LANES,
  },
  {
    commodity: '2 SUVs (dealer trade)', weight: [9_000, 11_000], length: [36, 40], equipment: [['HS_CAR_HAULER']],
    lanes: VEHICLE_LANES,
  },
];

const FLAT: EquipmentCode[][] = [['FLATBED']];
const FLAT_OR_CONESTOGA: EquipmentCode[][] = [['FLATBED'], ['FLATBED', 'CONESTOGA']];
const FLAT_OR_STEP: EquipmentCode[][] = [['FLATBED'], ['FLATBED', 'STEP_DECK']];
const STEP_OR_RGN: EquipmentCode[][] = [['STEP_DECK'], ['STEP_DECK', 'RGN']];
const STEP_OR_FLAT: EquipmentCode[][] = [['STEP_DECK'], ['STEP_DECK', 'FLATBED']];

const FLATBED: Freight[] = [
  {
    commodity: 'Lumber, 2x4 bunks', weight: [40_000, 46_500], length: [48, 48], equipment: FLAT_OR_CONESTOGA,
    tarp: 0.8, lanes: LUMBER_LANES,
  },
  {
    commodity: 'Plywood and OSB', weight: [42_000, 46_000], length: [48, 48], equipment: FLAT_OR_CONESTOGA, tarp: 0.9,
    lanes: LUMBER_LANES,
  },
  {
    commodity: 'Steel beams (W-flange)', weight: [36_000, 46_000], length: [40, 48], equipment: FLAT_OR_STEP,
    lanes: STEEL_LANES,
  },
  { commodity: 'Rebar bundles', weight: [40_000, 47_800], length: [40, 40], equipment: FLAT, lanes: STEEL_LANES },
  {
    commodity: 'Steel coils', weight: [38_000, 46_000], length: [20, 30], equipment: FLAT_OR_CONESTOGA, tarp: 0.7,
    lanes: STEEL_LANES,
  },
  {
    commodity: 'Oilfield casing, 5-1/2" (40 ft joints)', weight: [38_000, 46_500], length: [40, 44],
    equipment: FLAT_OR_STEP, lanes: CASING_LANES,
  },
  {
    commodity: 'Line pipe for gathering system', weight: [38_000, 46_000], length: [40, 48], equipment: FLAT_OR_STEP,
    lanes: CASING_LANES,
  },
  {
    commodity: 'Pipe fittings and flanges', weight: [20_000, 36_000], length: [24, 40], equipment: FLAT_OR_STEP,
    tarp: 0.3, lanes: CASING_LANES,
  },
  {
    commodity: 'Precast concrete barriers', weight: [40_000, 46_000], length: [40, 48], equipment: FLAT,
    lanes: BUILDING_LANES,
  },
  {
    commodity: 'Roofing shingles on pallets', weight: [40_000, 45_000], length: [48, 48],
    equipment: FLAT_OR_CONESTOGA, tarp: 0.6, lanes: BUILDING_LANES,
  },
  {
    commodity: 'PVC pipe', weight: [16_000, 24_000], length: [48, 48], equipment: FLAT_OR_CONESTOGA, tarp: 0.4,
    lanes: BUILDING_LANES,
  },
  {
    commodity: 'Brick and pavers on pallets', weight: [42_000, 47_000], length: [40, 48], equipment: FLAT,
    lanes: BUILDING_LANES,
  },
  {
    commodity: 'Solar panels on pallets', weight: [36_000, 42_000], length: [48, 48], equipment: FLAT_OR_CONESTOGA,
    tarp: 0.5, lanes: BUILDING_LANES,
  },
  {
    commodity: 'Nitrogen cylinders in racks (UN1066, Class 2.2)',
    weight: [18_000, 26_000],
    length: [24, 40],
    equipment: FLAT_OR_STEP,
    hazmat: true,
    lanes: CYLINDER_LANES,
  },
];

const HEAVY: Freight[] = [
  {
    commodity: 'Excavator (CAT 315)', weight: [33_000, 37_000], length: [28, 30], equipment: [['RGN']],
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Dozer (CAT D6)', weight: [38_000, 42_000], length: [18, 20], equipment: [['RGN']],
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Motor grader (CAT 140)', weight: [32_000, 37_000], length: [30, 32], equipment: [['RGN']],
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Wheel loader (CAT 926)', weight: [28_000, 31_000], length: [24, 26],
    equipment: [['RGN'], ['RGN', 'STEP_DECK']], lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Combine, header removed', weight: [33_000, 38_000], length: [30, 34],
    equipment: [['RGN', 'STEP_DECK']], lanes: FARM_MACHINERY_LANES,
  },
  {
    commodity: 'Row-crop tractor (John Deere 8R)', weight: [23_000, 28_000], length: [20, 22], equipment: STEP_OR_RGN,
    lanes: FARM_MACHINERY_LANES,
  },
  {
    commodity: 'Telehandler (JLG 1055)', weight: [24_000, 27_000], length: [24, 26], equipment: STEP_OR_RGN,
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Boom lift, 60 ft', weight: [22_000, 27_000], length: [30, 36], equipment: STEP_OR_RGN,
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Pad-mount transformer', weight: [28_000, 40_000], length: [14, 20], equipment: STEP_OR_RGN,
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Natural gas compressor skid', weight: [26_000, 40_000], length: [24, 32], equipment: STEP_OR_RGN,
    lanes: OILFIELD_HEAVY_LANES,
  },
  {
    commodity: 'Workover rig components', weight: [20_000, 38_000], length: [28, 40], equipment: STEP_OR_FLAT,
    lanes: OILFIELD_HEAVY_LANES,
  },
  {
    commodity: 'Scissor lifts (10)', weight: [30_000, 40_000], length: [44, 48], equipment: STEP_OR_FLAT,
    lanes: MACHINERY_LANES,
  },
  {
    commodity: 'Air-cooled chiller unit', weight: [16_000, 30_000], length: [20, 30], equipment: [['STEP_DECK']],
    lanes: BUILDING_LANES,
  },
];

const VAN_ONLY: EquipmentCode[][] = [['DRY_VAN']];
const VAN: Freight[] = [
  {
    commodity: 'Palletized retail goods', weight: [18_000, 40_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  { commodity: 'Canned beverages', weight: [40_000, 44_500], length: [53, 53], equipment: VAN_ONLY, lanes: VAN_LANES },
  { commodity: 'Bottled water', weight: [42_000, 44_500], length: [53, 53], equipment: VAN_ONLY, lanes: VAN_LANES },
  {
    commodity: 'Paper towels and tissue', weight: [10_000, 16_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  {
    commodity: 'Auto parts, floor-loaded', weight: [20_000, 36_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  {
    commodity: 'Appliances (washers and dryers)', weight: [18_000, 26_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  {
    commodity: 'Pet food on pallets', weight: [38_000, 44_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  {
    commodity: 'Packaged snack foods', weight: [16_000, 26_000], length: [53, 53],
    equipment: [['DRY_VAN'], ['DRY_VAN', 'REEFER']], lanes: VAN_LANES,
  },
  {
    commodity: 'Beer, cases and kegs', weight: [40_000, 44_000], length: [53, 53], equipment: [['DRY_VAN', 'REEFER']],
    lanes: VAN_LANES,
  },
  {
    commodity: 'Bagged mulch and potting soil', weight: [40_000, 44_000], length: [53, 53], equipment: VAN_ONLY,
    lanes: VAN_LANES,
  },
  {
    commodity: 'Paint and coatings (UN1263, Class 3)', weight: [30_000, 42_000], length: [53, 53],
    equipment: VAN_ONLY, hazmat: true, lanes: VAN_LANES,
  },
];

const REEFER_ONLY: EquipmentCode[][] = [['REEFER']];
const REEFER: Freight[] = [
  {
    commodity: 'Fresh avocados', weight: [38_000, 42_000], length: [53, 53], equipment: REEFER_ONLY, tempF: 40,
    lanes: toNationalDCs([...VALLEY_PRODUCE, 'nogales-az']),
  },
  {
    commodity: 'Tomatoes and bell peppers', weight: [36_000, 42_000], length: [53, 53], equipment: REEFER_ONLY,
    tempF: 55, lanes: toNationalDCs(['mcallen-tx', 'pharr-tx', 'nogales-az']),
  },
  {
    commodity: 'Watermelons in bins', weight: [40_000, 43_000], length: [53, 53], equipment: REEFER_ONLY, tempF: 55,
    lanes: toNationalDCs(VALLEY_PRODUCE),
  },
  {
    commodity: 'Leafy greens and lettuce', weight: [34_000, 40_000], length: [53, 53], equipment: REEFER_ONLY,
    tempF: 34, lanes: toNationalDCs(['salinas-ca', 'yuma-az', 'el-centro-ca', 'calexico-ca']),
  },
  {
    commodity: 'Fresh strawberries', weight: [30_000, 38_000], length: [53, 53], equipment: REEFER_ONLY, tempF: 34,
    lanes: toNationalDCs(['salinas-ca', 'fresno-ca']),
  },
  {
    commodity: 'Boxed beef', weight: [38_000, 42_000], length: [53, 53], equipment: REEFER_ONLY, tempF: 28,
    lanes: toNationalDCs(BEEF_PLANTS),
  },
  {
    commodity: 'Frozen chicken', weight: [40_000, 43_000], length: [53, 53], equipment: REEFER_ONLY, tempF: 0,
    lanes: toNationalDCs(['springdale-ar', 'rogers-ar', 'jackson-ms', 'hattiesburg-ms']),
  },
  {
    commodity: 'Frozen french fries', weight: [40_000, 43_000], length: [53, 53], equipment: REEFER_ONLY, tempF: -10,
    lanes: toNationalDCs(['pasco-wa', 'kennewick-wa', 'idaho-falls-id', 'twin-falls-id']),
  },
  {
    commodity: 'Dairy (milk and yogurt)', weight: [38_000, 42_000], length: [53, 53], equipment: REEFER_ONLY,
    tempF: 34, lanes: toNationalDCs(['twin-falls-id', 'green-bay-wi', 'madison-wi', 'visalia-ca']),
  },
  {
    commodity: 'Ice cream', weight: [36_000, 42_000], length: [53, 53], equipment: REEFER_ONLY, tempF: -20,
    lanes: toNationalDCs(['houston-tx', 'dallas-tx']),
  },
];

const TANK: EquipmentCode[][] = [['TANKER']];
/** Pneumatic dry bulk: no tanker (N) endorsement needed, since the trailer carries no liquid or gas. */
const DRY_BULK: EquipmentCode[][] = [['DRY_BULK']];
const TANKER: Freight[] = [
  {
    commodity: 'Hydrochloric acid, 15% (UN1789, Class 8)', weight: [40_000, 45_000], length: [42, 45],
    equipment: TANK, hazmat: true, lanes: FRAC_ACID_LANES,
  },
  {
    commodity: 'Sodium hydroxide solution (UN1824, Class 8)', weight: [40_000, 45_000], length: [42, 45],
    equipment: TANK, hazmat: true, lanes: CHEM_LANES,
  },
  {
    commodity: 'Methanol (UN1230, Class 3)', weight: [38_000, 44_000], length: [42, 45], equipment: TANK,
    hazmat: true, lanes: CHEM_LANES,
  },
  {
    commodity: 'Crude oil (UN1267, Class 3)', weight: [40_000, 45_000], length: [42, 45], equipment: TANK,
    hazmat: true, lanes: CRUDE_LANES,
  },
  {
    commodity: 'Liquid fertilizer (UAN-32)', weight: [42_000, 45_000], length: [42, 45], equipment: TANK,
    lanes: [lane(1, ['enid-ok', 'beaumont-tx', 'houston-tx'], PLAINS_AG)],
  },
  {
    commodity: 'Food-grade soybean oil', weight: [42_000, 45_000], length: [42, 45], equipment: TANK,
    lanes: [lane(1, ['des-moines-ia', 'decatur-il', 'kansas-city-mo'], NATIONAL_DC)],
  },
  {
    commodity: 'Drilling mud, water-based', weight: [40_000, 45_000], length: [42, 45], equipment: TANK,
    lanes: [lane(1, HOUSTON_SUPPLY, [...PERMIAN, ...HAYNESVILLE, ...EAGLE_FORD])],
  },
];

/** Permian frac sand mines and the pads and yards they feed. */
const SAND_MINES: CityList = ['kermit-tx', 'monahans-tx', 'crane-tx'];
const SAND_PADS: CityList = [
  'pecos-tx', 'carlsbad-nm', 'andrews-tx', 'midland-tx', 'hobbs-nm', 'big-spring-tx', 'fort-stockton-tx', 'jal-nm',
  'stanton-tx', 'denver-city-tx',
];
const DRY_BULK_FREIGHT: Freight[] = [
  {
    commodity: 'Frac sand, 40/70 mesh (pneumatic)', weight: [44_000, 47_000], length: [42, 45], equipment: DRY_BULK,
    lanes: [lane(1, SAND_MINES, SAND_PADS)],
  },
  {
    commodity: 'Oil well cement, Class H (pneumatic)', weight: [42_000, 46_000], length: [42, 45], equipment: DRY_BULK,
    lanes: [lane(1, ['odessa-tx', 'midland-tx'], SAND_PADS)],
  },
];

const POWER: EquipmentCode[][] = [['POWER_ONLY']];
const POWER_ONLY: Freight[] = [
  {
    commodity: 'Preloaded trailer: retail goods', weight: [20_000, 40_000], length: [53, 53], equipment: POWER,
    lanes: POWER_LANES,
  },
  {
    commodity: 'Preloaded trailer: auto parts',
    weight: [24_000, 38_000],
    length: [53, 53],
    equipment: POWER,
    lanes: [
      lane(
        1,
        ['laredo-tx', 'el-paso-tx'],
        ['detroit-mi', 'indianapolis-in', 'columbus-oh', 'nashville-tn', 'san-antonio-tx'],
      ),
    ],
  },
  {
    commodity: 'Preloaded trailer: empty pallets and totes', weight: [6_000, 12_000], length: [53, 53],
    equipment: POWER, lanes: POWER_LANES,
  },
];

// ---- Accounts ----

type ShipperKey = 'lonestar' | 'permian' | 'heartland' | 'riovalley' | 'crossroads';

interface ShipperSpec {
  key: ShipperKey;
  email: string;
  name: string;
  company: string;
  phone: string;
  refPrefix: string;
  /** When set, this shipper only posts freight that picks up in these cities. */
  territory?: CityList;
}

const SHIPPERS: ShipperSpec[] = [
  {
    key: 'lonestar', email: DEMO_EMAILS.shipper, name: 'Dana Whitfield', company: 'Lone Star Oilfield Supply',
    phone: '713-555-0148', refPrefix: 'LSO',
  },
  {
    key: 'permian', email: 'permian@demo.haulmatch.app', name: 'Ray Castillo', company: 'Permian Pipe & Valve',
    phone: '432-555-0119', refPrefix: 'PPV', territory: [...PERMIAN, 'san-angelo-tx'],
  },
  {
    key: 'heartland', email: 'heartland@demo.haulmatch.app', name: 'Karen Lindqvist',
    company: 'Heartland Implement Co.', phone: '515-555-0163', refPrefix: 'HIC',
  },
  {
    key: 'riovalley', email: 'riovalley@demo.haulmatch.app', name: 'Miguel Treviño', company: 'Rio Valley Produce',
    phone: '956-555-0127', refPrefix: 'RVP',
    territory: [
      ...VALLEY_PRODUCE, 'nogales-az', 'yuma-az', 'calexico-ca', 'el-centro-ca', 'salinas-ca', 'del-rio-tx',
      'el-paso-tx',
    ],
  },
  {
    key: 'crossroads', email: 'crossroads@demo.haulmatch.app', name: 'Sam Okafor',
    company: 'Crossroads Freight Brokerage', phone: '312-555-0191', refPrefix: 'XRD',
  },
];

interface GroupInfo {
  freight: Freight[];
  hotshot: boolean;
  shippers: (readonly [ShipperKey, number])[];
  instantShare: number;
  minMiles: number;
  maxMiles: number;
  notes: string[];
}

const GROUPS: Record<GroupKey, GroupInfo> = {
  oilfield: {
    freight: OILFIELD,
    hotshot: true,
    shippers: [['lonestar', 5], ['permian', 5], ['crossroads', 1]],
    instantShare: 0.45,
    minMiles: 40,
    maxMiles: 1_300,
    notes: [
      'Forklift on site at both ends.',
      'Bring 4 chains with binders and 6 straps.',
      'Call the yard an hour out; gate closes at 5 pm.',
      'Lease road for the last 8 miles, 4x4 recommended.',
      'Rig site delivery: company man signs the BOL.',
      'Hot shot: needed on location first thing.',
      'Crated freight, keep upright.',
      'FR clothing and hard hat required on location.',
    ],
  },
  ag: {
    freight: AG,
    hotshot: true,
    shippers: [['heartland', 8], ['lonestar', 1], ['crossroads', 1]],
    instantShare: 0.35,
    minMiles: 40,
    maxMiles: 900,
    notes: [
      'Farm delivery on a gravel drive; customer unloads with a loader.',
      'Dealer has a forklift at both ends.',
      'Call the customer 2 hours out, spotty cell service near the farm.',
      'Straps only, no chains on painted surfaces.',
      'Pickup at the dealer lot behind the shop.',
    ],
  },
  construction: {
    freight: CONSTRUCTION,
    hotshot: true,
    shippers: [['lonestar', 3], ['crossroads', 4], ['heartland', 2]],
    instantShare: 0.4,
    minMiles: 40,
    maxMiles: 900,
    notes: [
      'Jobsite delivery: call the foreman 30 minutes out.',
      'Residential street, no semis allowed.',
      'Forklift at pickup; jobsite unloads with a telehandler.',
      'Must be on site before 7 am.',
      'Edge protectors required.',
    ],
  },
  vehicles: {
    freight: VEHICLES,
    hotshot: true,
    shippers: [['crossroads', 1]],
    instantShare: 0.5,
    minMiles: 60,
    maxMiles: 900,
    notes: [
      'Vehicles run and drive.',
      'Gate pass and release sent after booking.',
      'Keys with the lot attendant.',
      'Photos required at pickup and delivery.',
    ],
  },
  flatbed: {
    freight: FLATBED,
    hotshot: false,
    shippers: [['lonestar', 3], ['crossroads', 6]],
    instantShare: 0.25,
    minMiles: 80,
    maxMiles: 1_600,
    notes: [
      'Appointment required at delivery.',
      'Shipper loads with an overhead crane.',
      'Edge protectors and 8 straps minimum.',
      'Mill pickup: hard hat, vest and safety glasses.',
      'Receiver unloads by forklift, 7 am to 3 pm.',
    ],
  },
  heavy: {
    freight: HEAVY,
    hotshot: false,
    shippers: [['heartland', 4], ['lonestar', 3], ['crossroads', 3]],
    instantShare: 0.15,
    minMiles: 80,
    maxMiles: 1_500,
    notes: [
      'Loaded by the dealer; driver secures with 8 chains and binders minimum.',
      'Legal dimensions, no permits needed.',
      'Unit runs; driver loads and unloads.',
      'Dealer yard, call an hour out.',
    ],
  },
  van: {
    freight: VAN,
    hotshot: false,
    shippers: [['crossroads', 6], ['riovalley', 4]],
    instantShare: 0.3,
    minMiles: 150,
    maxMiles: 2_400,
    notes: [
      'Appointment at delivery; FCFS at pickup.',
      'Lumper paid by receiver.',
      'Load bars required.',
      'Drop and hook at both ends.',
      'Seal must stay intact to the receiver.',
      'Floor-loaded, live unload.',
    ],
  },
  reefer: {
    freight: REEFER,
    hotshot: false,
    shippers: [['riovalley', 7], ['crossroads', 3]],
    instantShare: 0.25,
    minMiles: 150,
    maxMiles: 2_600,
    notes: [
      'Appointment at delivery; FCFS at pickup.',
      'Continuous run, no cycle.',
      'Food-grade trailer, washed out.',
      'Lumper reimbursed with receipt.',
    ],
  },
  tanker: {
    freight: TANKER,
    hotshot: false,
    shippers: [['lonestar', 5], ['crossroads', 5]],
    instantShare: 0.2,
    minMiles: 40,
    maxMiles: 900,
    notes: [
      'Wash-out ticket required before loading.',
      'Pump-off at delivery, bring hoses.',
      'Bottom-load at the terminal, appointment required.',
      'TWIC card needed at the terminal.',
    ],
  },
  dryBulk: {
    freight: DRY_BULK_FREIGHT,
    hotshot: false,
    shippers: [['permian', 2], ['lonestar', 1]],
    instantShare: 0.3,
    minMiles: 40,
    maxMiles: 400,
    notes: [
      'Blower on the tractor required; unload into the sand box at the pad.',
      'Dry product, no wash-out needed.',
      'Scale ticket at the mine before you leave.',
    ],
  },
  powerOnly: {
    freight: POWER_ONLY,
    hotshot: false,
    shippers: [['crossroads', 1]],
    instantShare: 0.5,
    minMiles: 100,
    maxMiles: 1_500,
    notes: [
      'Preloaded trailer, drop and hook.',
      '53 ft dry van trailer, seal intact.',
      'Hook to the trailer in door 12; paperwork at the guard shack.',
    ],
  },
};

const HOTSHOT_GROUPS: GroupKey[] = ['oilfield', 'ag', 'construction', 'vehicles'];
const SEMI_GROUPS: GroupKey[] = ['flatbed', 'heavy', 'van', 'reefer', 'tanker', 'powerOnly'];

/** Open loads by freight group, on top of the two clusters around the demo drivers. */
const OPEN_LOAD_MIX: [GroupKey, number][] = [
  ['oilfield', 38],
  ['ag', 14],
  ['construction', 12],
  ['vehicles', 6],
  ['flatbed', 16],
  ['heavy', 9],
  ['van', 12],
  ['reefer', 10],
  ['tanker', 6],
  ['powerOnly', 3],
  ['dryBulk', 3],
];

type DriverKey =
  | 'hotshot'
  | 'semi'
  | 'jake'
  | 'rosa'
  | 'andre'
  | 'luis'
  | 'beau'
  | 'keisha'
  | 'ivan'
  | 'earl'
  | 'travis'
  | 'hector';

interface DriverSpec {
  key: DriverKey;
  email: string;
  name: string;
  company: string | null;
  phone: string;
  driverClass: DriverClass;
  equipment: EquipmentCode[];
  trailerLengthFt: number;
  maxPayloadLbs: number;
  truck: string;
  cdlClass: 'A' | 'B' | null;
  endorsements: Endorsement[];
  team?: boolean;
  currentCityId: string;
  homeCityId: string;
  maxDeadheadMiles?: number;
  minRatePerMile?: number;
  preferredStates: string[];
  avoidStates?: string[];
  mpg?: number;
  rating: number;
  completedLoads: number;
  mcNumber: string | null;
  dotNumber: string | null;
  /** Hours until this driver is empty again; omitted = ready now. */
  busyForHours?: number;
}

const DRIVERS: DriverSpec[] = [
  {
    key: 'hotshot', email: DEMO_EMAILS.hotshot, name: 'Cody Ramirez', company: 'Ramirez Hot Shot LLC',
    phone: '432-555-0142', driverClass: 'hotshot', equipment: ['HS_GOOSENECK'], trailerLengthFt: 40,
    maxPayloadLbs: 10_000, truck: "2022 Ram 3500 dually + 40' PJ gooseneck", cdlClass: null, endorsements: [],
    currentCityId: 'odessa-tx', homeCityId: 'midland-tx', maxDeadheadMiles: 150, minRatePerMile: 1.5,
    preferredStates: ['TX', 'NM'], rating: 4.9, completedLoads: 46, mcNumber: '1184520', dotNumber: '3365871',
  },
  {
    key: 'semi', email: DEMO_EMAILS.semi, name: 'Marcus Bell', company: 'Bell Flatbed Inc.', phone: '214-555-0187',
    driverClass: 'semi', equipment: ['FLATBED', 'STEP_DECK'], trailerLengthFt: 48, maxPayloadLbs: 47_000,
    truck: "2021 Peterbilt 579 + 48' Fontaine flatbed and 48' step deck", cdlClass: 'A', endorsements: ['hazmat'],
    currentCityId: 'dallas-tx', homeCityId: 'dallas-tx', maxDeadheadMiles: 200, minRatePerMile: 2,
    preferredStates: ['TX', 'OK', 'LA', 'AR'], rating: 4.8, completedLoads: 212, mcNumber: '902211',
    dotNumber: '2514470',
  },
  {
    key: 'jake', email: 'jake.thompson@demo.haulmatch.app', name: 'Jake Thompson',
    company: 'Thompson Hotshot Services', phone: '701-555-0134', driverClass: 'hotshot', equipment: ['HS_GOOSENECK'],
    trailerLengthFt: 40, maxPayloadLbs: 16_500, truck: "2023 Ford F-450 + 40' Big Tex gooseneck", cdlClass: 'A',
    endorsements: [], currentCityId: 'williston-nd', homeCityId: 'billings-mt', maxDeadheadMiles: 200,
    preferredStates: ['ND', 'MT', 'WY'], rating: 4.7, completedLoads: 131, mcNumber: '1092385', dotNumber: '3110458',
  },
  {
    key: 'rosa', email: 'rosa.delgado@demo.haulmatch.app', name: 'Rosa Delgado', company: 'Delgado Express',
    phone: '405-555-0158', driverClass: 'hotshot', equipment: ['HS_DOVETAIL', 'HS_GOOSENECK'], trailerLengthFt: 40,
    maxPayloadLbs: 15_000, truck: "2022 Chevy Silverado 3500HD + 40' Load Trail dovetail", cdlClass: 'A',
    endorsements: [], currentCityId: 'oklahoma-city-ok', homeCityId: 'chickasha-ok',
    preferredStates: ['OK', 'TX', 'KS'], rating: 4.9, completedLoads: 88, mcNumber: '1201447', dotNumber: '3452209',
  },
  {
    key: 'andre', email: 'andre.wallace@demo.haulmatch.app', name: 'Andre Wallace', company: 'Wallace Auto Transport',
    phone: '832-555-0176', driverClass: 'hotshot', equipment: ['HS_CAR_HAULER'], trailerLengthFt: 40,
    maxPayloadLbs: 10_000, truck: "2021 Ram 3500 + 40' 3-car wedge", cdlClass: null, endorsements: [],
    currentCityId: 'houston-tx', homeCityId: 'houston-tx', minRatePerMile: 1.6, preferredStates: ['TX', 'LA'],
    rating: 4.6, completedLoads: 57, mcNumber: '1150932', dotNumber: '3301276',
  },
  {
    key: 'luis', email: 'luis.ortega@demo.haulmatch.app', name: 'Luis Ortega', company: null, phone: '210-555-0112',
    driverClass: 'hotshot', equipment: ['HS_BUMPER_PULL'], trailerLengthFt: 28, maxPayloadLbs: 9_000,
    truck: "2020 Ford F-350 SRW + 28' bumper-pull flatbed", cdlClass: null, endorsements: [],
    currentCityId: 'san-antonio-tx', homeCityId: 'pleasanton-tx', maxDeadheadMiles: 120, preferredStates: ['TX'],
    rating: 4.5, completedLoads: 19, mcNumber: '1263018', dotNumber: '3520994',
  },
  {
    key: 'beau', email: 'beau.thibodeaux@demo.haulmatch.app', name: 'Beau Thibodeaux', company: 'Bayou Hotshot LLC',
    phone: '337-555-0165', driverClass: 'hotshot', equipment: ['HS_GOOSENECK', 'HS_DOVETAIL'], trailerLengthFt: 40,
    maxPayloadLbs: 16_500, truck: "2023 Ram 5500 + 40' Diamond C dovetail gooseneck", cdlClass: 'A',
    endorsements: ['hazmat', 'twic'], currentCityId: 'lafayette-la', homeCityId: 'new-iberia-la',
    maxDeadheadMiles: 250, preferredStates: ['LA', 'TX'], rating: 4.8, completedLoads: 174, mcNumber: '1033871',
    dotNumber: '2987412',
  },
  {
    key: 'keisha', email: 'keisha.morgan@demo.haulmatch.app', name: 'Keisha Morgan', company: 'Morgan Logistics',
    phone: '404-555-0139', driverClass: 'semi', equipment: ['DRY_VAN', 'POWER_ONLY'], trailerLengthFt: 53,
    maxPayloadLbs: 45_000, truck: "2022 Freightliner Cascadia + 53' Wabash dry van", cdlClass: 'A', endorsements: [],
    currentCityId: 'atlanta-ga', homeCityId: 'atlanta-ga', maxDeadheadMiles: 150,
    preferredStates: ['GA', 'TN', 'FL', 'NC', 'SC'], rating: 4.7, completedLoads: 265, mcNumber: '884302',
    dotNumber: '2398811',
  },
  {
    key: 'ivan', email: 'ivan.petrov@demo.haulmatch.app', name: 'Ivan Petrov', company: 'Petrov Team Transport',
    phone: '602-555-0181', driverClass: 'semi', equipment: ['REEFER', 'DRY_VAN'], trailerLengthFt: 53,
    maxPayloadLbs: 43_500, truck: "2023 Volvo VNL 860 + 53' Utility reefer (team)", cdlClass: 'A', endorsements: [],
    team: true, currentCityId: 'chicago-il', homeCityId: 'phoenix-az', maxDeadheadMiles: 250, minRatePerMile: 2.2,
    preferredStates: ['AZ', 'CA', 'TX'], avoidStates: ['NY'], rating: 4.9, completedLoads: 342, mcNumber: '765520',
    dotNumber: '2104437', busyForHours: 20,
  },
  {
    key: 'earl', email: 'earl.jenkins@demo.haulmatch.app', name: 'Earl Jenkins', company: 'Jenkins Trucking',
    phone: '205-555-0123', driverClass: 'semi', equipment: ['FLATBED', 'CONESTOGA'], trailerLengthFt: 48,
    maxPayloadLbs: 46_000, truck: "2020 Kenworth W900 + 48' Reitnouer flatbed with Conestoga kit", cdlClass: 'A',
    endorsements: [], currentCityId: 'birmingham-al', homeCityId: 'birmingham-al',
    preferredStates: ['AL', 'MS', 'GA', 'TN', 'LA'], rating: 4.6, completedLoads: 498, mcNumber: '541128',
    dotNumber: '1650332',
  },
  {
    key: 'travis', email: 'travis.kemp@demo.haulmatch.app', name: 'Travis Kemp', company: 'Kemp Heavy Haul',
    phone: '303-555-0152', driverClass: 'semi', equipment: ['STEP_DECK', 'RGN'], trailerLengthFt: 53,
    maxPayloadLbs: 42_000, truck: "2022 Peterbilt 389 + 53' Fontaine step deck / Talbert RGN", cdlClass: 'A',
    endorsements: [], currentCityId: 'denver-co', homeCityId: 'greeley-co', maxDeadheadMiles: 300,
    minRatePerMile: 2.6, preferredStates: ['CO', 'WY', 'NE', 'KS'], rating: 4.8, completedLoads: 207,
    mcNumber: '933476', dotNumber: '2601985',
  },
  {
    key: 'hector', email: 'hector.salinas@demo.haulmatch.app', name: 'Hector Salinas', company: 'Salinas Tank Lines',
    phone: '361-555-0144', driverClass: 'semi', equipment: ['TANKER', 'DRY_BULK'], trailerLengthFt: 45,
    maxPayloadLbs: 45_000, truck: '2021 Mack Anthem + 9,000 gal stainless tank or 1,600 cu ft pneumatic',
    cdlClass: 'A', endorsements: ['hazmat', 'tanker', 'twic'],
    currentCityId: 'pasadena-tx', homeCityId: 'corpus-christi-tx', preferredStates: ['TX', 'LA'], rating: 4.7,
    completedLoads: 289, mcNumber: '812094', dotNumber: '2276650',
  },
];

// ---- Seeding context and row writers ----

interface Account {
  id: string;
  name: string;
  company: string | null;
}

interface LoadDraft {
  shipper: ShipperKey;
  status: LoadStatus;
  originCityId: string;
  destCityId: string;
  pickupStart: number;
  pickupEnd: number;
  deliveryBy: number | null;
  equipmentTypes: EquipmentCode[];
  weightLbs: number;
  lengthFt: number;
  commodity: string;
  notes: string;
  loadSize: LoadSize;
  hazmat: boolean;
  tarpRequired: boolean;
  teamRequired: boolean;
  rateUsd: number;
  miles: number;
  bookingMode: BookingMode;
  referenceNumber: string | null;
  createdAt: number;
}

interface SeededLoad extends LoadDraft {
  id: string;
}

interface Statements {
  user: StatementSync;
  profile: StatementSync;
  load: StatementSync;
  booking: StatementSync;
  message: StatementSync;
  notification: StatementSync;
  savedSearch: StatementSync;
}

interface SeedCtx {
  db: Db;
  sql: Statements;
  now: number;
  rng: Rng;
  ids: Rng;
  passwordHash: string;
  shippers: Map<ShipperKey, Account>;
  drivers: Map<DriverKey, Account>;
  profiles: Map<DriverKey, DriverProfile>;
  loads: SeededLoad[];
}

function prepareStatements(db: Db): Statements {
  return {
    user: db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, company, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    profile: db.prepare(
      `INSERT INTO driver_profiles (user_id, driver_class, equipment_types, trailer_length_ft, max_payload_lbs,
        truck_description, mc_number, dot_number, has_cdl, cdl_class, endorsements, team_driver, current_city_id,
        home_city_id, available, available_from, max_deadhead_miles, min_rate_per_mile, preferred_states, avoid_states,
        mpg, fuel_price, rating, completed_loads, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    load: db.prepare(
      `INSERT INTO loads (id, shipper_id, status, origin_city_id, dest_city_id, pickup_start, pickup_end, delivery_by,
        equipment_types, weight_lbs, length_ft, commodity, notes, load_size, hazmat, tarp_required, team_required,
        rate_usd, miles, booking_mode, reference_number, booked_driver_id, booked_rate_usd, created_at, updated_at,
        picked_up_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    booking: db.prepare(
      `INSERT INTO bookings (id, load_id, driver_id, status, offer_rate_usd, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    message: db.prepare(
      `INSERT INTO messages (id, load_id, driver_id, sender_id, body, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    notification: db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, link, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    savedSearch: db.prepare(
      'INSERT INTO saved_searches (id, user_id, name, filters, alerts_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));
const floorHour = (ms: number): number => Math.floor(ms / HOUR) * HOUR;
const ceilHour = (ms: number): number => Math.ceil(ms / HOUR) * HOUR;
const startOfUtcDay = (ms: number): number => Math.floor(ms / DAY) * DAY;
const roundTo = (value: number, step: number): number => Math.round(value / step) * step;
const usd = (amount: number): string => `$${amount.toLocaleString('en-US')}`;

function place(cityId: string): Place {
  const found = placeForCityId(cityId);
  if (!found) throw new Error(`Seed data references unknown city "${cityId}"`);
  return found;
}

const milesBetween = (from: string, to: string): number => roadMiles(place(from), place(to));
const laneLabel = (load: Pick<LoadDraft, 'originCityId' | 'destCityId'>): string => {
  const a = place(load.originCityId);
  const b = place(load.destCityId);
  return `${a.city}, ${a.state} → ${b.city}, ${b.state}`;
};
const driverLoadLink = (loadId: string): string => `/driver/loads/${loadId}`;
const shipperLoadLink = (loadId: string): string => `/shipper/loads/${loadId}`;
const threadLink = (loadId: string, driverId: string): string => `/messages/${loadId}/${driverId}`;

function insertAccount(
  ctx: SeedCtx,
  spec: { email: string; name: string; company: string | null; phone: string },
  role: 'driver' | 'shipper',
  createdAt: number,
): Account {
  const id = ctx.ids.uuid();
  ctx.sql.user.run(id, spec.email, ctx.passwordHash, spec.name, role, spec.company, spec.phone, iso(createdAt));
  return { id, name: spec.name, company: spec.company };
}

function insertDriver(ctx: SeedCtx, spec: DriverSpec): void {
  const createdAt = startOfUtcDay(ctx.now) - ctx.rng.int(60, 540) * DAY + ctx.rng.int(13, 22) * HOUR;
  const account = insertAccount(ctx, spec, 'driver', createdAt);
  const defaults = DRIVER_CLASSES[spec.driverClass];
  const availableFrom = spec.busyForHours ? ceilHour(ctx.now + spec.busyForHours * HOUR) : null;
  ctx.sql.profile.run(
    account.id,
    spec.driverClass,
    JSON.stringify(spec.equipment),
    spec.trailerLengthFt,
    spec.maxPayloadLbs,
    spec.truck,
    spec.mcNumber,
    spec.dotNumber,
    bool(spec.cdlClass !== null),
    spec.cdlClass,
    JSON.stringify(spec.endorsements),
    bool(spec.team ?? false),
    spec.currentCityId,
    spec.homeCityId,
    bool(true),
    isoOrNull(availableFrom),
    spec.maxDeadheadMiles ?? defaults.defaultMaxDeadheadMiles,
    spec.minRatePerMile ?? defaults.defaultMinRatePerMile,
    JSON.stringify(spec.preferredStates),
    JSON.stringify(spec.avoidStates ?? []),
    spec.mpg ?? defaults.defaultMpg,
    DEFAULT_FUEL_PRICE_PER_GALLON,
    spec.rating,
    spec.completedLoads,
    iso(ctx.now - ctx.rng.int(2, 72) * HOUR),
  );
  ctx.drivers.set(spec.key, account);
  ctx.profiles.set(spec.key, getDriverProfile(ctx.db, account.id)!);
}

interface Assignment {
  driverId: string;
  rateUsd: number;
  pickedUpAt: number | null;
  deliveredAt: number | null;
}

function insertLoad(ctx: SeedCtx, draft: LoadDraft, updatedAt = draft.createdAt, assignment?: Assignment): SeededLoad {
  const id = ctx.ids.uuid();
  ctx.sql.load.run(
    id,
    ctx.shippers.get(draft.shipper)!.id,
    draft.status,
    draft.originCityId,
    draft.destCityId,
    iso(draft.pickupStart),
    iso(draft.pickupEnd),
    isoOrNull(draft.deliveryBy),
    JSON.stringify(draft.equipmentTypes),
    draft.weightLbs,
    draft.lengthFt,
    draft.commodity,
    draft.notes,
    draft.loadSize,
    bool(draft.hazmat),
    bool(draft.tarpRequired),
    bool(draft.teamRequired),
    draft.rateUsd,
    draft.miles,
    draft.bookingMode,
    draft.referenceNumber,
    assignment?.driverId ?? null,
    assignment?.rateUsd ?? null,
    iso(draft.createdAt),
    iso(updatedAt),
    isoOrNull(assignment?.pickedUpAt ?? null),
    isoOrNull(assignment?.deliveredAt ?? null),
  );
  const load = { ...draft, id };
  ctx.loads.push(load);
  return load;
}

interface BookingInput {
  loadId: string;
  driverId: string;
  status: BookingStatus;
  offerRateUsd: number | null;
  message: string;
  createdAt: number;
  updatedAt?: number;
}

function insertBooking(ctx: SeedCtx, b: BookingInput): void {
  const id = ctx.ids.uuid();
  const updatedAt = b.updatedAt ?? b.createdAt;
  ctx.sql.booking.run(id, b.loadId, b.driverId, b.status, b.offerRateUsd, b.message, iso(b.createdAt), iso(updatedAt));
}

interface MessageInput {
  loadId: string;
  driverId: string;
  senderId: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

function insertMessage(ctx: SeedCtx, m: MessageInput): void {
  ctx.sql.message.run(ctx.ids.uuid(), m.loadId, m.driverId, m.senderId, m.body, iso(m.createdAt), isoOrNull(m.readAt));
}

interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  createdAt: number;
  read: boolean;
}

function insertNotification(ctx: SeedCtx, userId: string, n: NotificationInput): void {
  const readAt = n.read ? Math.min(ctx.now, n.createdAt + 15 * MINUTE) : null;
  const id = ctx.ids.uuid();
  ctx.sql.notification.run(id, userId, n.type, n.title, n.body, n.link, iso(n.createdAt), isoOrNull(readAt));
}

// ---- Load generation ----

interface Route {
  from: string;
  to: string;
  miles: number;
}

function pickRoute(rng: Rng, lanes: Lane[], minMiles: number, maxMiles: number): Route {
  const entries = lanes.map((l) => [l, l.weight] as const);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chosen = rng.weighted(entries);
    const from = rng.pick(chosen.from);
    const to = rng.pick(chosen.to);
    if (from === to) continue;
    const miles = milesBetween(from, to);
    if (miles >= minMiles && miles <= maxMiles) return { from, to, miles };
  }
  throw new Error('Seed lanes produced no route within the mileage limits');
}

/** Hotshot freight lists gooseneck plus whatever else could carry it, as brokers post it. */
function hotshotEquipment(rng: Rng, freight: Freight, weightLbs: number, lengthFt: number): EquipmentCode[] {
  const codes: EquipmentCode[] = ['HS_GOOSENECK'];
  if (freight.driveOn || rng.chance(0.3)) codes.push('HS_DOVETAIL');
  const bumper = EQUIPMENT.HS_BUMPER_PULL;
  if (weightLbs <= bumper.typicalPayloadLbs && lengthFt <= bumper.typicalLengthFt && rng.chance(0.5)) {
    codes.push('HS_BUMPER_PULL');
  }
  if (freight.driveOn) {
    if (rng.chance(0.5)) codes.push('STEP_DECK');
  } else if (rng.chance(0.6)) {
    codes.push('FLATBED');
    if (rng.chance(0.4)) codes.push('STEP_DECK');
  }
  return codes;
}

interface Cargo {
  commodity: string;
  equipmentTypes: EquipmentCode[];
  weightLbs: number;
  lengthFt: number;
  hazmat: boolean;
  tarpRequired: boolean;
  loadSize: LoadSize;
  notes: string;
}

function makeCargo(rng: Rng, group: GroupKey, freight: Freight): Cargo {
  const info = GROUPS[group];
  let weightLbs = Math.min(freight.weight[1], Math.max(freight.weight[0], roundTo(rng.float(...freight.weight), 100)));
  let lengthFt = rng.int(...freight.length);
  if (info.hotshot) {
    weightLbs = Math.min(weightLbs, HOTSHOT_MAX_PAYLOAD_LBS);
    lengthFt = Math.min(lengthFt, HOTSHOT_MAX_LENGTH_FT);
  }
  const equipmentTypes = freight.equipment
    ? [...rng.pick(freight.equipment)]
    : hotshotEquipment(rng, freight, weightLbs, lengthFt);
  const hazmat = freight.hazmat ?? false;
  const tarpRequired = rng.chance(freight.tarp ?? 0);
  // Light semi freight (paper, empty pallets) still fills a trailer by volume, so only small hotshot freight is LTL.
  const partial = info.hotshot && weightLbs <= 6_000 && lengthFt <= 20;
  const notes: string[] = [];
  if (freight.tempF !== undefined) {
    notes.push(`Reefer at ${freight.tempF}°F, continuous. Pulp temps checked at pickup.`);
  }
  if (tarpRequired) notes.push(info.hotshot ? 'Tarp required.' : 'Tarps required: 6 ft drops.');
  if (freight.driveOn) notes.push('Drive-on/drive-off: ramps required.');
  if (hazmat) notes.push('Placards provided by shipper.');
  notes.push(rng.pick(info.notes));
  return {
    commodity: freight.commodity,
    equipmentTypes,
    weightLbs,
    lengthFt,
    hazmat,
    tarpRequired,
    loadSize: partial && rng.chance(0.5) ? 'partial' : 'full',
    notes: notes.join(' '),
  };
}

/** Rate near market: estimateRate ±15%, rounded to $25 like a broker posts it. */
function marketRate(rng: Rng, miles: number, equipment: EquipmentCode[]): number {
  const suggested = estimateRate(miles, equipment).suggestedUsd;
  return Math.max(25, roundTo(suggested * rng.float(0.85, 1.15), 25));
}

function chooseShipper(rng: Rng, group: GroupKey, originCityId: string): ShipperKey {
  const allowed = GROUPS[group].shippers.filter(([key]) => {
    const territory = SHIPPERS.find((s) => s.key === key)!.territory;
    return !territory || territory.includes(originCityId);
  });
  return allowed.length > 0 ? rng.weighted(allowed) : 'crossroads';
}

interface Timing {
  pickupStart: number;
  pickupEnd: number;
  deliveryBy: number | null;
}

/** Open loads pick up between now+2h and now+7d, in a 2–10h window during US daytime, mostly in the next few days. */
function openTiming(rng: Rng, now: number, miles: number): Timing {
  const windowHours = rng.pick([2, 3, 4, 4, 6, 6, 8, 10]);
  const daysAhead = rng.weighted([[0, 30], [1, 25], [2, 18], [3, 12], [4, 7], [5, 5], [6, 3]] as const);
  // 11:00–21:00 UTC is 6 am–4 pm in US Central daylight time.
  let pickupStart = startOfUtcDay(now) + daysAhead * DAY + rng.int(11, 21) * HOUR;
  while (pickupStart < now + 2 * HOUR) pickupStart += DAY;
  if (pickupStart + windowHours * HOUR > now + 7 * DAY) pickupStart -= DAY;
  const pickupEnd = pickupStart + windowHours * HOUR;
  const deliveryBy = rng.chance(0.1) ? null : ceilHour(pickupEnd + (transitHours(miles) + rng.int(2, 14)) * HOUR);
  return { pickupStart, pickupEnd, deliveryBy };
}

function buildDraft(
  ctx: SeedCtx,
  group: GroupKey,
  cargo: Cargo,
  route: Route,
  timing: Timing,
  overrides: { shipper?: ShipperKey; status?: LoadStatus; bookingMode?: BookingMode } = {},
): LoadDraft {
  const { rng } = ctx;
  const info = GROUPS[group];
  const shipper = overrides.shipper ?? chooseShipper(rng, group, route.from);
  const prefix = SHIPPERS.find((s) => s.key === shipper)!.refPrefix;
  const longHaulFreight = group === 'van' || group === 'reefer';
  return {
    shipper,
    status: overrides.status ?? 'open',
    originCityId: route.from,
    destCityId: route.to,
    ...timing,
    ...cargo,
    teamRequired: longHaulFreight && route.miles > 1_500 && rng.chance(0.4),
    rateUsd: marketRate(rng, route.miles, cargo.equipmentTypes),
    miles: route.miles,
    bookingMode: overrides.bookingMode ?? (rng.chance(info.instantShare) ? 'instant' : 'request'),
    referenceNumber: rng.chance(0.85) ? `${prefix}-${rng.int(10_000, 99_999)}` : null,
    createdAt: Math.min(ctx.now, timing.pickupStart) - rng.int(3, 40) * HOUR - rng.int(0, 59) * MINUTE,
  };
}

function randomOpenLoad(ctx: SeedCtx, group: GroupKey): LoadDraft {
  const info = GROUPS[group];
  const freight = ctx.rng.pick(info.freight);
  const route = pickRoute(ctx.rng, freight.lanes, info.minMiles, info.maxMiles);
  const cargo = makeCargo(ctx.rng, group, freight);
  return buildDraft(ctx, group, cargo, route, openTiming(ctx.rng, ctx.now, route.miles));
}

const toMatchable = (load: LoadDraft): MatchableLoad => ({
  status: load.status,
  origin: place(load.originCityId),
  destination: place(load.destCityId),
  pickupStart: iso(load.pickupStart),
  pickupEnd: iso(load.pickupEnd),
  equipmentTypes: load.equipmentTypes,
  weightLbs: load.weightLbs,
  lengthFt: load.lengthFt,
  hazmat: load.hazmat,
  teamRequired: load.teamRequired,
  rateUsd: load.rateUsd,
  miles: load.miles,
});

const matchFor = (ctx: SeedCtx, load: LoadDraft, driver: DriverProfile, ignoreDeadheadLimit = false): MatchResult =>
  matchLoad(toMatchable(load), driver, { now: new Date(ctx.now), ignoreDeadheadLimit });

/** Checks about the rig and the paperwork only, for history loads whose timing and deadhead are long past. */
const RIG_CHECKS = new Set(['equipment', 'weight', 'length', 'cdl', 'hazmat', 'tanker', 'team', 'avoid_state']);
const rigFits = (ctx: SeedCtx, load: LoadDraft, driver: DriverProfile): boolean =>
  matchFor(ctx, load, driver, true).checks.every((c) => c.ok || !RIG_CHECKS.has(c.key));

interface ClusterSpec {
  driver: DriverKey;
  groups: GroupKey[];
  destinations: CityList;
  originPool: CityList;
  /** Loads the demo driver can book (inside their deadhead limit). */
  eligible: number;
  /** Nearby loads that miss on weight, equipment or paperwork, so the board shows why. */
  misses: number;
}

/**
 * Loads picking up close to a demo driver, so their board opens full. Candidates are generated with
 * the normal rules and kept until both quotas are filled.
 */
function clusterLoads(ctx: SeedCtx, spec: ClusterSpec): void {
  const profile = ctx.profiles.get(spec.driver)!;
  const home = profile.currentLocation!;
  const reach = profile.maxDeadheadMiles - 10;
  const origins = spec.originPool.filter((id) => roadMiles(home, place(id)) <= reach);
  let eligible = 0;
  let misses = 0;
  for (let attempt = 0; attempt < 2_000 && (eligible < spec.eligible || misses < spec.misses); attempt += 1) {
    const group = ctx.rng.pick(spec.groups);
    const info = GROUPS[group];
    const from = ctx.rng.pick(origins);
    const to = ctx.rng.pick(spec.destinations);
    if (from === to) continue;
    const miles = milesBetween(from, to);
    if (miles < info.minMiles || miles > info.maxMiles) continue;
    const cargo = makeCargo(ctx.rng, group, ctx.rng.pick(info.freight));
    const draft = buildDraft(ctx, group, cargo, { from, to, miles }, openTiming(ctx.rng, ctx.now, miles));
    const ok = matchFor(ctx, draft, profile).eligible;
    if (ok && eligible < spec.eligible) eligible += 1;
    else if (!ok && misses < spec.misses) misses += 1;
    else continue;
    insertLoad(ctx, draft);
  }
  if (eligible < spec.eligible) throw new Error(`Could not build ${spec.eligible} eligible loads for ${spec.driver}`);
}

function seedOpenLoads(ctx: SeedCtx): void {
  clusterLoads(ctx, {
    driver: 'hotshot',
    groups: ['oilfield', 'oilfield', 'oilfield', 'construction'],
    originPool: PERMIAN,
    destinations: PERMIAN_OUTBOUND,
    eligible: 18,
    misses: 4,
  });
  clusterLoads(ctx, {
    driver: 'semi',
    groups: ['flatbed', 'flatbed', 'heavy', 'construction'],
    originPool: DFW_AREA,
    destinations: DFW_OUTBOUND,
    eligible: 18,
    misses: 3,
  });
  for (const [group, count] of OPEN_LOAD_MIX) {
    for (let i = 0; i < count; i += 1) insertLoad(ctx, randomOpenLoad(ctx, group));
  }
}

// ---- History: booked, in transit, delivered and cancelled ----

type HaulStatus = 'booked' | 'in_transit' | 'delivered';

interface HaulTiming extends Timing {
  pickedUpAt: number | null;
  deliveredAt: number | null;
}

/**
 * @param anchor booked: pickup start (future) · in_transit: when it was picked up (past) ·
 *   delivered: pickup start (past; moved earlier if the run could not have finished by now).
 */
function haulTiming(ctx: SeedCtx, status: HaulStatus, miles: number, anchor: number): HaulTiming {
  const transit = transitHours(miles) * HOUR;
  if (status === 'booked') {
    const pickupEnd = anchor + 4 * HOUR;
    const deliveryBy = ceilHour(pickupEnd + transit + 4 * HOUR);
    return { pickupStart: anchor, pickupEnd, deliveryBy, pickedUpAt: null, deliveredAt: null };
  }
  if (status === 'in_transit') {
    const pickupStart = anchor - HOUR;
    const pickupEnd = pickupStart + 4 * HOUR;
    const deliveryBy = ceilHour(pickupEnd + transit + 2 * HOUR);
    return { pickupStart, pickupEnd, deliveryBy, pickedUpAt: anchor, deliveredAt: null };
  }
  const pickupStart = Math.min(anchor, floorHour(ctx.now - transit - 8 * HOUR));
  const pickupEnd = pickupStart + 4 * HOUR;
  const pickedUpAt = pickupStart + HOUR;
  return {
    pickupStart,
    pickupEnd,
    deliveryBy: ceilHour(pickupEnd + transit + 2 * HOUR),
    pickedUpAt,
    deliveredAt: pickedUpAt + transit + 30 * MINUTE,
  };
}

interface HaulResult {
  load: SeededLoad;
  timing: HaulTiming;
  bookedAt: number;
  acceptedAt: number;
  rateUsd: number;
}

/** Insert a load already assigned to a driver, with its accepted booking. */
function insertHaul(
  ctx: SeedCtx,
  draft: LoadDraft,
  timing: HaulTiming,
  driverKey: DriverKey,
  offerRateUsd: number | null = null,
  message = '',
): HaulResult {
  const driver = ctx.drivers.get(driverKey)!;
  const rateUsd = offerRateUsd ?? draft.rateUsd;
  // Somewhere in the first half of the time between posting and pickup (or now, if pickup is later).
  const span = Math.min(ctx.now, timing.pickupStart) - draft.createdAt;
  const bookedAt = draft.createdAt + Math.floor(span * ctx.rng.float(0.15, 0.45));
  const acceptedAt = draft.bookingMode === 'instant' ? bookedAt : bookedAt + ctx.rng.int(10, 50) * MINUTE;
  const status: LoadStatus =
    timing.deliveredAt !== null ? 'delivered' : timing.pickedUpAt !== null ? 'in_transit' : 'booked';
  const load = insertLoad(ctx, { ...draft, status }, timing.deliveredAt ?? timing.pickedUpAt ?? acceptedAt, {
    driverId: driver.id,
    rateUsd,
    pickedUpAt: timing.pickedUpAt,
    deliveredAt: timing.deliveredAt,
  });
  insertBooking(ctx, {
    loadId: load.id,
    driverId: driver.id,
    status: 'accepted',
    offerRateUsd,
    message,
    createdAt: bookedAt,
    updatedAt: acceptedAt,
  });
  return { load, timing, bookedAt, acceptedAt, rateUsd };
}

interface DemoHaulSpec {
  status: HaulStatus | 'cancelled';
  route: [string, string];
  cargo: Omit<Cargo, 'loadSize'>;
  group: GroupKey;
  bookingMode: BookingMode;
  /** Accepted counter-offer above the posted rate. */
  offerUpUsd?: number;
}

const demoCargo = (
  commodity: string,
  equipmentTypes: EquipmentCode[],
  weightLbs: number,
  lengthFt: number,
  notes: string,
  extra: Partial<Pick<Cargo, 'hazmat' | 'tarpRequired'>> = {},
): Omit<Cargo, 'loadSize'> => ({
  commodity,
  equipmentTypes,
  weightLbs,
  lengthFt,
  notes,
  hazmat: false,
  tarpRequired: false,
  ...extra,
});

const HOTSHOT_HISTORY: DemoHaulSpec[] = [
  {
    status: 'booked',
    route: ['midland-tx', 'carlsbad-nm'],
    group: 'oilfield',
    bookingMode: 'instant',
    cargo: demoCargo(
      'Gate valves and wellhead parts (crated)',
      ['HS_GOOSENECK', 'FLATBED'],
      6_800,
      16,
      'Crated freight, keep upright. Forklift on site at both ends.',
    ),
  },
  {
    status: 'in_transit',
    route: ['san-angelo-tx', 'odessa-tx'],
    group: 'oilfield',
    bookingMode: 'request',
    cargo: demoCargo(
      'Frac pump fluid end',
      ['HS_GOOSENECK', 'HS_DOVETAIL', 'FLATBED'],
      8_900,
      12,
      'Hot shot: needed on location first thing.',
    ),
  },
  {
    status: 'delivered',
    route: ['houston-tx', 'midland-tx'],
    group: 'oilfield',
    bookingMode: 'request',
    cargo: demoCargo(
      'Oilfield tubing, 2-7/8" joints',
      ['HS_GOOSENECK', 'FLATBED'],
      9_600,
      38,
      'Bring 4 chains with binders and 6 straps.',
    ),
  },
  {
    status: 'delivered',
    route: ['odessa-tx', 'hobbs-nm'],
    group: 'oilfield',
    bookingMode: 'instant',
    cargo: demoCargo(
      'Frac iron and chiksans',
      ['HS_GOOSENECK', 'HS_DOVETAIL'],
      7_200,
      24,
      'Rig site delivery: company man signs the BOL.',
    ),
  },
  {
    status: 'delivered',
    route: ['midland-tx', 'oklahoma-city-ok'],
    group: 'oilfield',
    bookingMode: 'request',
    cargo: demoCargo(
      'Generator, 150 kW skid-mounted',
      ['HS_GOOSENECK', 'FLATBED', 'STEP_DECK'],
      8_400,
      16,
      'Forklift on site at both ends.',
    ),
  },
  {
    status: 'cancelled',
    route: ['odessa-tx', 'pecos-tx'],
    group: 'oilfield',
    bookingMode: 'request',
    cargo: demoCargo(
      'Light towers (2)',
      ['HS_GOOSENECK', 'HS_DOVETAIL'],
      6_000,
      24,
      'Drive-on/drive-off: ramps required.',
    ),
  },
];

const SEMI_HISTORY: DemoHaulSpec[] = [
  {
    status: 'booked',
    route: ['fort-worth-tx', 'odessa-tx'],
    group: 'flatbed',
    bookingMode: 'request',
    offerUpUsd: 150,
    cargo: demoCargo(
      'Oilfield casing, 5-1/2" (40 ft joints)',
      ['FLATBED', 'STEP_DECK'],
      44_500,
      42,
      'Shipper loads with an overhead crane.',
    ),
  },
  {
    status: 'in_transit',
    route: ['houston-tx', 'tulsa-ok'],
    group: 'flatbed',
    bookingMode: 'request',
    cargo: demoCargo('Steel beams (W-flange)', ['FLATBED'], 41_200, 45, 'Edge protectors and 8 straps minimum.'),
  },
  {
    status: 'delivered',
    route: ['houston-tx', 'dallas-tx'],
    group: 'flatbed',
    bookingMode: 'instant',
    cargo: demoCargo(
      'Line pipe for gathering system',
      ['FLATBED', 'STEP_DECK'],
      43_800,
      48,
      'Receiver unloads by forklift, 7 am to 3 pm.',
    ),
  },
  {
    status: 'delivered',
    route: ['dallas-tx', 'shreveport-la'],
    group: 'flatbed',
    bookingMode: 'request',
    cargo: demoCargo(
      'Pipe fittings and flanges',
      ['FLATBED', 'STEP_DECK'],
      28_000,
      32,
      'Tarps required: 6 ft drops.',
      { tarpRequired: true },
    ),
  },
  {
    status: 'delivered',
    route: ['beaumont-tx', 'dallas-tx'],
    group: 'flatbed',
    bookingMode: 'request',
    cargo: demoCargo(
      'Nitrogen cylinders in racks (UN1066, Class 2.2)',
      ['FLATBED', 'STEP_DECK'],
      22_000,
      36,
      'Placards provided by shipper.',
      { hazmat: true },
    ),
  },
];

interface DemoHistory {
  booked: HaulResult;
  inTransit: HaulResult;
  delivered: HaulResult[];
  cancelled: SeededLoad | null;
}

/** When each demo haul happens, relative to now: tomorrow morning, a few hours ago, and days back. */
function demoAnchor(ctx: SeedCtx, status: HaulStatus, index: number, driver: DriverKey): number {
  const today = startOfUtcDay(ctx.now);
  if (status === 'booked') return today + (driver === 'hotshot' ? 1 : 2) * DAY + 13 * HOUR;
  if (status === 'in_transit') return floorHour(ctx.now) - (driver === 'hotshot' ? 2 : 4) * HOUR;
  const daysAgo = [11, 7, 4][index % 3] - (driver === 'hotshot' ? 1 : 0);
  return today - daysAgo * DAY + 13 * HOUR;
}

function seedDemoHistory(ctx: SeedCtx, driverKey: 'hotshot' | 'semi', specs: DemoHaulSpec[]): DemoHistory {
  const result: Partial<DemoHistory> = { delivered: [], cancelled: null };
  let deliveredIndex = 0;
  for (const spec of specs) {
    const route = { from: spec.route[0], to: spec.route[1], miles: milesBetween(spec.route[0], spec.route[1]) };
    const cargo: Cargo = { ...spec.cargo, loadSize: 'full' };
    if (spec.status === 'cancelled') {
      result.cancelled = seedDemoCancellation(ctx, driverKey, spec, cargo, route);
      continue;
    }
    const anchor = demoAnchor(ctx, spec.status, deliveredIndex, driverKey);
    const timing = haulTiming(ctx, spec.status, route.miles, anchor);
    const draft = buildDraft(ctx, spec.group, cargo, route, timing, {
      shipper: 'lonestar',
      bookingMode: spec.bookingMode,
    });
    const offer = spec.offerUpUsd ? draft.rateUsd + spec.offerUpUsd : null;
    const note = offer ? `Can do it for ${usd(offer)} with tarps.` : '';
    const haul = insertHaul(ctx, draft, timing, driverKey, offer, note);
    if (spec.status === 'booked') result.booked = haul;
    else if (spec.status === 'in_transit') result.inTransit = haul;
    else {
      result.delivered!.push(haul);
      deliveredIndex += 1;
    }
  }
  return result as DemoHistory;
}

/** A load the demo driver had requested before the shipper pulled it, so their trips show a cancellation. */
function seedDemoCancellation(
  ctx: SeedCtx,
  driverKey: DriverKey,
  spec: DemoHaulSpec,
  cargo: Cargo,
  route: Route,
): SeededLoad {
  const pickupStart = startOfUtcDay(ctx.now) - DAY + 14 * HOUR;
  const timing: Timing = {
    pickupStart,
    pickupEnd: pickupStart + 4 * HOUR,
    deliveryBy: ceilHour(pickupStart + (4 + transitHours(route.miles) + 3) * HOUR),
  };
  const draft = buildDraft(ctx, spec.group, cargo, route, timing, {
    shipper: 'lonestar',
    status: 'cancelled',
    bookingMode: spec.bookingMode,
  });
  const requestedAt = draft.createdAt + HOUR;
  const cancelledAt = requestedAt + HOUR;
  const load = insertLoad(ctx, draft, cancelledAt);
  const driver = ctx.drivers.get(driverKey)!;
  insertBooking(ctx, {
    loadId: load.id,
    driverId: driver.id,
    status: 'cancelled',
    offerRateUsd: null,
    message: '',
    createdAt: requestedAt,
    updatedAt: cancelledAt,
  });
  insertNotification(ctx, driver.id, {
    type: 'load_cancelled',
    title: `Cancelled: ${laneLabel(load)}`,
    body: 'Lone Star Oilfield Supply cancelled this load.',
    link: driverLoadLink(load.id),
    createdAt: cancelledAt,
    read: true,
  });
  return load;
}

/** History for the rest of the fleet: who hauled what, recently. */
const FLEET_HISTORY: [DriverKey, HaulStatus][] = [
  ['jake', 'delivered'],
  ['jake', 'in_transit'],
  ['rosa', 'delivered'],
  ['rosa', 'booked'],
  ['andre', 'delivered'],
  ['luis', 'delivered'],
  ['beau', 'delivered'],
  ['beau', 'delivered'],
  ['keisha', 'delivered'],
  ['keisha', 'in_transit'],
  ['ivan', 'delivered'],
  ['earl', 'delivered'],
  ['earl', 'booked'],
  ['travis', 'delivered'],
  ['hector', 'delivered'],
  ['hector', 'in_transit'],
];

function fleetAnchor(ctx: SeedCtx, status: HaulStatus): number {
  const today = startOfUtcDay(ctx.now);
  if (status === 'booked') return today + ctx.rng.int(1, 3) * DAY + ctx.rng.int(12, 18) * HOUR;
  if (status === 'in_transit') return floorHour(ctx.now) - ctx.rng.int(1, 6) * HOUR;
  return today - ctx.rng.int(2, 20) * DAY + ctx.rng.int(11, 20) * HOUR;
}

function seedFleetHistory(ctx: SeedCtx): void {
  for (const [driverKey, status] of FLEET_HISTORY) {
    const profile = ctx.profiles.get(driverKey)!;
    const groups = profile.driverClass === 'hotshot' ? HOTSHOT_GROUPS : SEMI_GROUPS;
    for (let attempt = 0; ; attempt += 1) {
      if (attempt === 500) throw new Error(`No history load fits ${driverKey}`);
      const group = ctx.rng.pick(groups);
      const info = GROUPS[group];
      const freight = ctx.rng.pick(info.freight);
      const route = pickRoute(ctx.rng, freight.lanes, info.minMiles, info.maxMiles);
      const timing = haulTiming(ctx, status, route.miles, fleetAnchor(ctx, status));
      const draft = buildDraft(ctx, group, makeCargo(ctx.rng, group, freight), route, timing);
      if (!rigFits(ctx, draft, profile)) continue;
      insertHaul(ctx, draft, timing, driverKey);
      break;
    }
  }
  // Two loads shippers pulled before anyone booked them.
  for (const group of ['construction', 'van'] as const) {
    const draft = randomOpenLoad(ctx, group);
    insertLoad(ctx, { ...draft, status: 'cancelled' }, draft.createdAt + ctx.rng.int(1, 2) * HOUR);
  }
}

// ---- Requests, conversations, alerts ----

interface PendingRequest {
  load: SeededLoad;
  driverKey: DriverKey;
  offerRateUsd: number | null;
  message: string;
  createdAt: number;
}

const openRequestLoads = (ctx: SeedCtx, shipper: ShipperKey): SeededLoad[] =>
  ctx.loads.filter((l) => l.shipper === shipper && l.status === 'open' && l.bookingMode === 'request');

function bestEligible(
  ctx: SeedCtx,
  loads: SeededLoad[],
  driver: DriverProfile,
  ignoreDeadheadLimit: boolean,
): SeededLoad | null {
  const ranked = loads
    .map((load) => ({ load, match: matchFor(ctx, load, driver, ignoreDeadheadLimit) }))
    .filter((c) => c.match.eligible)
    .sort((a, b) => compareMatches(a.match, b.match));
  return ranked[0]?.load ?? null;
}

const REQUEST_NOTES = [
  'Empty in {city} and can be there when the window opens.',
  'Have chains, straps and tarps. Can load first thing.',
  'Hauled this lane last month, know the yard. Ready when you are.',
  'Running light today, can pick up early if they are ready.',
];

function placeRequest(
  ctx: SeedCtx,
  load: SeededLoad,
  driverKey: DriverKey,
  withCounter: boolean,
  note: string,
): PendingRequest {
  const driver = ctx.drivers.get(driverKey)!;
  const profile = ctx.profiles.get(driverKey)!;
  const offerRateUsd = withCounter ? roundTo(load.rateUsd * ctx.rng.float(1.06, 1.12), 25) + 25 : null;
  const message = (withCounter ? `Can do it at ${usd(offerRateUsd!)}, long deadhead back out of there. ` : '') +
    note.replace('{city}', profile.currentLocation!.city);
  // Halfway-ish between posting and now, so follow-up messages still land in the past.
  const createdAt = load.createdAt + Math.floor((ctx.now - load.createdAt) * ctx.rng.float(0.2, 0.5));
  insertBooking(ctx, {
    loadId: load.id,
    driverId: driver.id,
    status: 'pending',
    offerRateUsd,
    message,
    createdAt,
  });
  const terms = offerRateUsd
    ? `offers ${usd(offerRateUsd)} (posted ${usd(load.rateUsd)})`
    : `at your posted ${usd(load.rateUsd)}`;
  insertNotification(ctx, ctx.shippers.get(load.shipper)!.id, {
    type: 'booking_request',
    title: `New request from ${driver.name}`,
    body: `${laneLabel(load)} · ${terms} · "${message}"`,
    link: shipperLoadLink(load.id),
    createdAt,
    read: ctx.now - createdAt > 8 * HOUR,
  });
  return { load, driverKey, offerRateUsd, message, createdAt };
}

/** Other drivers asking for the demo shipper's loads: the requests tab has something to accept. */
function seedPendingRequests(ctx: SeedCtx): PendingRequest[] {
  const candidates: DriverKey[] = ['beau', 'rosa', 'earl', 'hector', 'jake', 'travis', 'luis'];
  const requests: PendingRequest[] = [];
  const taken = new Set<string>();
  for (const driverKey of candidates) {
    if (requests.length === 4) break;
    const pool = openRequestLoads(ctx, 'lonestar').filter((l) => !taken.has(l.id));
    const load = bestEligible(ctx, pool, ctx.profiles.get(driverKey)!, true);
    if (!load) continue;
    taken.add(load.id);
    const withCounter = requests.length === 0 || requests.length === 2;
    const note = REQUEST_NOTES[requests.length % REQUEST_NOTES.length];
    requests.push(placeRequest(ctx, load, driverKey, withCounter, note));
  }
  if (requests.length < 3) throw new Error('Not enough eligible drivers to request the demo shipper loads');
  // Each demo driver also has a request out with another shipper.
  const hotshotLoad = bestEligible(ctx, openRequestLoads(ctx, 'permian'), ctx.profiles.get('hotshot')!, false);
  if (hotshotLoad) placeRequest(ctx, hotshotLoad, 'hotshot', false, REQUEST_NOTES[0]);
  const semiLoad = bestEligible(ctx, openRequestLoads(ctx, 'crossroads'), ctx.profiles.get('semi')!, false);
  if (semiLoad) placeRequest(ctx, semiLoad, 'semi', true, REQUEST_NOTES[1]);
  return requests;
}

type Line = [from: 'driver' | 'shipper', minutesLater: number, body: string];

/** Writes a conversation; everything is read except trailing lines the recipient has not opened yet. */
function seedThread(
  ctx: SeedCtx,
  load: SeededLoad,
  driverKey: DriverKey,
  startAt: number,
  lines: Line[],
  unreadTail: number,
): void {
  const driver = ctx.drivers.get(driverKey)!;
  const shipper = ctx.shippers.get(load.shipper)!;
  const last = lines.length - 1;
  lines.forEach(([from, minutes, body], i) => {
    const createdAt = startAt + minutes * MINUTE;
    const nextAt = i < last ? startAt + lines[i + 1][1] * MINUTE : createdAt + 5 * MINUTE;
    const senderId = from === 'driver' ? driver.id : shipper.id;
    const unread = i > last - unreadTail;
    const readAt = unread ? null : Math.min(ctx.now, nextAt);
    insertMessage(ctx, { loadId: load.id, driverId: driver.id, senderId, body, createdAt, readAt });
    const recipientId = from === 'driver' ? shipper.id : driver.id;
    insertNotification(ctx, recipientId, {
      type: 'message',
      title: `Message from ${from === 'driver' ? driver.name : (shipper.company ?? shipper.name)}`,
      body: `${laneLabel(load)}: ${body.length > 80 ? `${body.slice(0, 79)}…` : body}`,
      link: threadLink(load.id, driver.id),
      createdAt,
      read: !unread,
    });
  });
}

function seedThreads(ctx: SeedCtx, hotshot: DemoHistory, semi: DemoHistory, requests: PendingRequest[]): void {
  seedThread(ctx, hotshot.booked.load, 'hotshot', hotshot.booked.bookedAt + 20 * MINUTE, [
    [
      'shipper',
      0,
      'Thanks for grabbing this one, Cody. Valves are crated on two pallets at our Midland yard off I-20. ' +
        'Ask for Ray at the shop.',
    ],
    ['driver', 25, "Copy. I'll be there right at 8. Need anything besides straps?"],
    ['shipper', 50, 'Bring a couple of edge protectors. Delivery is the Carlsbad yard on US-62, gate code 4417.'],
  ], 1);

  const transitStart = semi.inTransit.timing.pickedUpAt! + 15 * MINUTE;
  seedThread(ctx, semi.inTransit.load, 'semi', transitStart, [
    ['driver', 0, 'Loaded and rolling out of Houston. 14 beams, all chained and flagged.'],
    ['shipper', 25, 'Perfect. Receiver is dock 3 at the fab shop. Call Jimmy 30 minutes out at 918-555-0173.'],
    ['driver', 75, 'Will do. Fuel stop in Denison, then straight in.'],
  ], 1);

  const counter = requests.find((r) => r.offerRateUsd !== null) ?? requests[0];
  const meetAt = roundTo((counter.load.rateUsd + (counter.offerRateUsd ?? counter.load.rateUsd + 100)) / 2, 25);
  seedThread(ctx, counter.load, counter.driverKey, counter.createdAt + 10 * MINUTE, [
    ['driver', 0, "Sent you a request on this one. Fuel's up and I'd deadhead back, can you get closer to my number?"],
    ['shipper', 30, `I can meet you at ${usd(meetAt)} if you can be loaded by 10 am.`],
    ['driver', 45, `${usd(meetAt)} works. I'll be there when the window opens.`],
  ], 1);
}

interface SavedSearchSpec {
  driver: DriverKey;
  name: string;
  filters: LoadSearchFilters;
}

const SAVED_SEARCHES: SavedSearchSpec[] = [
  {
    driver: 'hotshot', name: 'Permian hotshot runs',
    filters: { originCityId: 'odessa-tx', originRadiusMiles: 150, equipment: ['HS_GOOSENECK'], maxWeightLbs: 10_000 },
  },
  {
    driver: 'hotshot', name: 'Loads into New Mexico',
    filters: { destinationStates: ['NM'], equipment: ['HS_GOOSENECK'], minRatePerMile: 1.75 },
  },
  {
    driver: 'semi', name: 'DFW flatbed outbound',
    filters: { originCityId: 'dallas-tx', originRadiusMiles: 200, equipment: ['FLATBED', 'STEP_DECK'] },
  },
  {
    driver: 'semi', name: 'Texas & Oklahoma, $2.50+',
    filters: { destinationStates: ['TX', 'OK'], minRatePerMile: 2.5, equipment: ['FLATBED', 'STEP_DECK'] },
  },
  {
    driver: 'jake', name: 'Bakken gooseneck',
    filters: { originCityId: 'williston-nd', originRadiusMiles: 200, equipment: ['HS_GOOSENECK'] },
  },
  {
    driver: 'beau', name: 'Gulf Coast hotshot',
    filters: { destinationStates: ['LA', 'TX'], equipment: ['HS_GOOSENECK', 'HS_DOVETAIL'] },
  },
];

function seedSavedSearches(ctx: SeedCtx): void {
  for (const spec of SAVED_SEARCHES) {
    const createdAt = ctx.now - ctx.rng.int(5, 60) * DAY - ctx.rng.int(0, 23) * HOUR;
    const driverId = ctx.drivers.get(spec.driver)!.id;
    const filters = JSON.stringify(spec.filters);
    ctx.sql.savedSearch.run(ctx.ids.uuid(), driverId, spec.name, filters, bool(true), iso(createdAt));
  }
}

const matchSummary = (match: MatchResult): string =>
  match.deadheadMiles === null ? `${match.score} match` : `${match.score} match, ${match.deadheadMiles} mi deadhead`;

/** The alerts a demo driver would have received as today's loads were posted. */
function seedLoadAlerts(ctx: SeedCtx, driverKey: DriverKey, requested: Set<string>): void {
  const profile = ctx.profiles.get(driverKey)!;
  const driver = ctx.drivers.get(driverKey)!;
  const open = ctx.loads
    .filter((l) => l.status === 'open' && !requested.has(l.id))
    .map((l) => ({ draft: l, load: getLoadById(ctx.db, l.id)!, match: matchFor(ctx, l, profile) }))
    .filter((c) => c.match.eligible);
  const used = new Set<string>();
  const alert = (c: (typeof open)[number], title: string, body: string) => {
    used.add(c.load.id);
    insertNotification(ctx, driver.id, {
      type: 'load_match',
      title,
      body,
      link: driverLoadLink(c.load.id),
      createdAt: c.draft.createdAt + 2 * MINUTE,
      read: ctx.now - c.draft.createdAt > 20 * HOUR,
    });
  };
  for (const search of SAVED_SEARCHES.filter((s) => s.driver === driverKey)) {
    const hit = open
      .filter((c) => !used.has(c.load.id) && loadPassesFilters(c.load, search.filters))
      .sort((a, b) => b.draft.createdAt - a.draft.createdAt)[0];
    if (hit) {
      const title = `New load: ${laneLabel(hit.draft)} · ${usd(hit.draft.rateUsd)}`;
      alert(hit, title, `Fits your saved search "${search.name}" · ${matchSummary(hit.match)}`);
    }
  }
  const hot = open.filter((c) => !used.has(c.load.id)).sort((a, b) => compareMatches(a.match, b.match))[0];
  if (hot) {
    const body = `${laneLabel(hot.draft)} · ${usd(hot.draft.rateUsd)} · ${matchSummary(hot.match)}`;
    alert(hot, 'Hot match near you', body);
  }
}

/** What the demo shipper and the semi driver were told as the history above unfolded. */
function seedHistoryNotifications(ctx: SeedCtx, hotshot: DemoHistory, semi: DemoHistory): void {
  const shipperId = ctx.shippers.get('lonestar')!.id;
  const cody = ctx.drivers.get('hotshot')!;
  const marcus = ctx.drivers.get('semi')!;
  insertNotification(ctx, shipperId, {
    type: 'load_booked',
    title: `Booked: ${laneLabel(hotshot.booked.load)}`,
    body: `${cody.name} booked it at ${usd(hotshot.booked.rateUsd)}.`,
    link: shipperLoadLink(hotshot.booked.load.id),
    createdAt: hotshot.booked.bookedAt,
    read: true,
  });
  insertNotification(ctx, marcus.id, {
    type: 'booking_accepted',
    title: `You're booked: ${laneLabel(semi.booked.load)}`,
    body: `Lone Star Oilfield Supply accepted your request at ${usd(semi.booked.rateUsd)}.`,
    link: driverLoadLink(semi.booked.load.id),
    createdAt: semi.booked.acceptedAt,
    read: true,
  });
  insertNotification(ctx, shipperId, {
    type: 'load_status',
    title: `Picked up: ${laneLabel(semi.inTransit.load)}`,
    body: `${marcus.name} picked up the load and is rolling.`,
    link: shipperLoadLink(semi.inTransit.load.id),
    createdAt: semi.inTransit.timing.pickedUpAt!,
    read: false,
  });
  const lastDelivery = hotshot.delivered[hotshot.delivered.length - 1];
  insertNotification(ctx, shipperId, {
    type: 'load_status',
    title: `Delivered: ${laneLabel(lastDelivery.load)}`,
    body: `${cody.name} delivered the load.`,
    link: shipperLoadLink(lastDelivery.load.id),
    createdAt: lastDelivery.timing.deliveredAt!,
    read: true,
  });
}

// ---- Entry points ----

function emptySummary(): SeedSummary {
  return {
    users: 0,
    drivers: 0,
    shippers: 0,
    loads: 0,
    openLoads: 0,
    bookings: 0,
    pendingRequests: 0,
    messages: 0,
    notifications: 0,
    savedSearches: 0,
  };
}

function summarize(db: Db): SeedSummary {
  const count = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
  return {
    users: count('SELECT COUNT(*) AS n FROM users'),
    drivers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'driver'"),
    shippers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'shipper'"),
    loads: count('SELECT COUNT(*) AS n FROM loads'),
    openLoads: count("SELECT COUNT(*) AS n FROM loads WHERE status = 'open'"),
    bookings: count('SELECT COUNT(*) AS n FROM bookings'),
    pendingRequests: count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"),
    messages: count('SELECT COUNT(*) AS n FROM messages'),
    notifications: count('SELECT COUNT(*) AS n FROM notifications'),
    savedSearches: count('SELECT COUNT(*) AS n FROM saved_searches'),
  };
}

let demoPasswordHash: string | null = null;

/**
 * Fill an empty database with demo data. Deterministic: the same `now` always produces the same rows
 * (ids included; only password salts differ). Does nothing if any user exists.
 */
export function seedDatabase(db: Db, opts: { now?: Date } = {}): SeedSummary {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (Number(n) > 0) return emptySummary();
  // scrypt is slow on purpose; every demo account shares one hash.
  demoPasswordHash ??= hashPasswordSync(DEMO_PASSWORD);
  const ctx: SeedCtx = {
    db,
    sql: prepareStatements(db),
    now: (opts.now ?? new Date()).getTime(),
    rng: new Rng(SEED),
    ids: new Rng(SEED ^ 0x9e3779b9),
    passwordHash: demoPasswordHash,
    shippers: new Map(),
    drivers: new Map(),
    profiles: new Map(),
    loads: [],
  };
  transaction(db, () => {
    for (const spec of SHIPPERS) {
      const createdAt = startOfUtcDay(ctx.now) - ctx.rng.int(120, 700) * DAY + ctx.rng.int(13, 22) * HOUR;
      ctx.shippers.set(spec.key, insertAccount(ctx, spec, 'shipper', createdAt));
    }
    for (const spec of DRIVERS) insertDriver(ctx, spec);
    seedOpenLoads(ctx);
    const hotshot = seedDemoHistory(ctx, 'hotshot', HOTSHOT_HISTORY);
    const semi = seedDemoHistory(ctx, 'semi', SEMI_HISTORY);
    seedFleetHistory(ctx);
    const requests = seedPendingRequests(ctx);
    seedThreads(ctx, hotshot, semi, requests);
    seedHistoryNotifications(ctx, hotshot, semi);
    seedSavedSearches(ctx);
    const pending = db.prepare("SELECT load_id FROM bookings WHERE status = 'pending'").all() as { load_id: string }[];
    const requested = new Set(pending.map((r) => r.load_id));
    seedLoadAlerts(ctx, 'hotshot', requested);
    seedLoadAlerts(ctx, 'semi', requested);
  });
  return summarize(db);
}

function runCli(args: string[]): void {
  const dbPath = resolve(process.env.HAULMATCH_DB ?? 'data/haulmatch.db');
  if (args.includes('--reset')) {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(file, { force: true });
  }
  const db = openDb(dbPath);
  try {
    const summary = seedDatabase(db, { now: new Date() });
    if (summary.users === 0) {
      console.log(`${dbPath} already has users; nothing seeded. Run with --reset to start over.`);
      return;
    }
    console.log(`Seeded ${dbPath}`);
    console.log(
      `  ${summary.users} users (${summary.drivers} drivers, ${summary.shippers} shippers) · ` +
        `${summary.loads} loads (${summary.openLoads} open)`,
    );
    console.log(
      `  ${summary.bookings} bookings (${summary.pendingRequests} pending) · ${summary.messages} messages · ` +
        `${summary.notifications} notifications · ${summary.savedSearches} saved searches`,
    );
    console.log(`  Demo logins (password "${DEMO_PASSWORD}"): ${Object.values(DEMO_EMAILS).join(', ')}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2));
}
