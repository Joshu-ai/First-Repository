// Row <-> DTO mapping shared by every route. Rows come straight from node:sqlite.
import { placeForCityId } from '../shared/cities';
import type {
  AppNotification,
  Booking,
  BookingMode,
  BookingStatus,
  DriverClass,
  DriverProfile,
  DriverSummary,
  Endorsement,
  EquipmentCode,
  Load,
  LoadSearchFilters,
  LoadSize,
  LoadStatus,
  Message,
  NotificationType,
  Place,
  Role,
  SavedSearch,
  User,
} from '../shared/types';
import { parseJsonArray, type Db } from './db';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const flag = (v: unknown): boolean => Number(v) === 1;

/** Resolve a stored city id. Unknown ids (dataset changed) degrade to a coordinate-less place. */
export function placeFor(cityId: unknown): Place | null {
  if (cityId == null || cityId === '') return null;
  return placeForCityId(String(cityId)) ?? { cityId: String(cityId), city: String(cityId), state: '', lat: 0, lng: 0 };
}

export function toUser(row: Row): User {
  return {
    id: str(row.id),
    email: str(row.email),
    name: str(row.name),
    role: str(row.role) as Role,
    company: strOrNull(row.company),
    phone: strOrNull(row.phone),
    createdAt: str(row.created_at),
  };
}

export function getUserById(db: Db, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return row ? toUser(row) : null;
}

export function toDriverProfile(row: Row): DriverProfile {
  const equipmentTypes = parseJsonArray<EquipmentCode>(row.equipment_types);
  const currentLocation = placeFor(row.current_city_id);
  return {
    userId: str(row.user_id),
    driverClass: str(row.driver_class) as DriverClass,
    equipmentTypes,
    trailerLengthFt: num(row.trailer_length_ft),
    maxPayloadLbs: num(row.max_payload_lbs),
    truckDescription: str(row.truck_description),
    mcNumber: strOrNull(row.mc_number),
    dotNumber: strOrNull(row.dot_number),
    hasCdl: flag(row.has_cdl),
    cdlClass: strOrNull(row.cdl_class) as DriverProfile['cdlClass'],
    endorsements: parseJsonArray<Endorsement>(row.endorsements),
    teamDriver: flag(row.team_driver),
    currentLocation,
    homeBase: placeFor(row.home_city_id),
    available: flag(row.available),
    availableFrom: strOrNull(row.available_from),
    maxDeadheadMiles: num(row.max_deadhead_miles),
    minRatePerMile: num(row.min_rate_per_mile),
    preferredStates: parseJsonArray<string>(row.preferred_states),
    avoidStates: parseJsonArray<string>(row.avoid_states),
    mpg: num(row.mpg),
    fuelPricePerGallon: num(row.fuel_price),
    rating: num(row.rating),
    completedLoads: num(row.completed_loads),
    profileComplete:
      equipmentTypes.length > 0 && num(row.max_payload_lbs) > 0 && num(row.trailer_length_ft) > 0 && currentLocation !== null,
    updatedAt: str(row.updated_at),
  };
}

export function getDriverProfile(db: Db, userId: string): DriverProfile | null {
  const row = db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').get(userId) as Row | undefined;
  return row ? toDriverProfile(row) : null;
}

export function toDriverSummary(user: User, profile: DriverProfile): DriverSummary {
  return {
    userId: user.id,
    name: user.name,
    company: user.company,
    phone: user.phone,
    driverClass: profile.driverClass,
    equipmentTypes: profile.equipmentTypes,
    trailerLengthFt: profile.trailerLengthFt,
    maxPayloadLbs: profile.maxPayloadLbs,
    truckDescription: profile.truckDescription,
    hasCdl: profile.hasCdl,
    endorsements: profile.endorsements,
    mcNumber: profile.mcNumber,
    dotNumber: profile.dotNumber,
    rating: profile.rating,
    completedLoads: profile.completedLoads,
    currentLocation: profile.currentLocation,
    available: profile.available,
  };
}

export function getDriverSummary(db: Db, userId: string): DriverSummary | null {
  const user = getUserById(db, userId);
  const profile = user ? getDriverProfile(db, userId) : null;
  return user && profile ? toDriverSummary(user, profile) : null;
}

/** Select loads with shipper name/company and live pending-request count. Append WHERE/ORDER as needed. */
export const LOAD_SELECT = `
SELECT l.*, u.name AS shipper_name, u.company AS shipper_company,
  (SELECT COUNT(*) FROM bookings b WHERE b.load_id = l.id AND b.status = 'pending') AS pending_count
FROM loads l JOIN users u ON u.id = l.shipper_id`;

/**
 * @param viewerId Who will see the load. pendingRequestCount is only revealed to the shipper who owns
 * it, and who has it booked (and at what rate) only to that shipper and the booked driver, never to
 * drivers who lost it. Omit the viewer for internal reads that need the raw values.
 */
export function toLoad(row: Row, viewerId?: string | null): Load {
  const miles = Math.max(1, num(row.miles));
  const rateUsd = num(row.rate_usd);
  const shipperId = str(row.shipper_id);
  const bookedDriverId = strOrNull(row.booked_driver_id);
  const seesBooking = viewerId == null || viewerId === shipperId || viewerId === bookedDriverId;
  return {
    id: str(row.id),
    shipperId,
    shipperName: str(row.shipper_name),
    shipperCompany: strOrNull(row.shipper_company),
    status: str(row.status) as LoadStatus,
    origin: placeFor(row.origin_city_id)!,
    destination: placeFor(row.dest_city_id)!,
    pickupStart: str(row.pickup_start),
    pickupEnd: str(row.pickup_end),
    deliveryBy: strOrNull(row.delivery_by),
    equipmentTypes: parseJsonArray<EquipmentCode>(row.equipment_types),
    weightLbs: num(row.weight_lbs),
    lengthFt: num(row.length_ft),
    commodity: str(row.commodity),
    notes: str(row.notes),
    loadSize: str(row.load_size) as LoadSize,
    hazmat: flag(row.hazmat),
    tarpRequired: flag(row.tarp_required),
    teamRequired: flag(row.team_required),
    rateUsd,
    miles,
    ratePerMile: Math.round((rateUsd / miles) * 100) / 100,
    bookingMode: str(row.booking_mode) as BookingMode,
    referenceNumber: strOrNull(row.reference_number),
    bookedDriverId: seesBooking ? bookedDriverId : null,
    bookedRateUsd: seesBooking ? numOrNull(row.booked_rate_usd) : null,
    pendingRequestCount: viewerId && viewerId === shipperId ? num(row.pending_count) : 0,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    pickedUpAt: strOrNull(row.picked_up_at),
    deliveredAt: strOrNull(row.delivered_at),
  };
}

export function getLoadById(db: Db, id: string, viewerId?: string | null): Load | null {
  const row = db.prepare(`${LOAD_SELECT} WHERE l.id = ?`).get(id) as Row | undefined;
  return row ? toLoad(row, viewerId) : null;
}

export function toBooking(row: Row): Booking {
  return {
    id: str(row.id),
    loadId: str(row.load_id),
    driverId: str(row.driver_id),
    status: str(row.status) as BookingStatus,
    offerRateUsd: numOrNull(row.offer_rate_usd),
    message: str(row.message),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/** Expects a row from messages joined with users AS sender_name. */
export function toMessage(row: Row): Message {
  return {
    id: str(row.id),
    loadId: str(row.load_id),
    driverId: str(row.driver_id),
    senderId: str(row.sender_id),
    senderName: str(row.sender_name),
    body: str(row.body),
    createdAt: str(row.created_at),
    readAt: strOrNull(row.read_at),
  };
}

export function toNotification(row: Row): AppNotification {
  return {
    id: str(row.id),
    type: str(row.type) as NotificationType,
    title: str(row.title),
    body: str(row.body),
    link: strOrNull(row.link),
    createdAt: str(row.created_at),
    readAt: strOrNull(row.read_at),
  };
}

export function toSavedSearch(row: Row): SavedSearch {
  let filters: LoadSearchFilters = {};
  try {
    const parsed = JSON.parse(str(row.filters) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) filters = parsed as LoadSearchFilters;
  } catch {
    filters = {};
  }
  return {
    id: str(row.id),
    name: str(row.name),
    filters,
    alertsEnabled: flag(row.alerts_enabled),
    createdAt: str(row.created_at),
  };
}
