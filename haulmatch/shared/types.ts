// Shared data contracts between the HaulMatch API server and the web client.
// Every timestamp is an ISO-8601 string in UTC. Money is whole US dollars unless noted.

export type Role = 'driver' | 'shipper';

/** Hotshot = pickup (usually a 1-ton dually) pulling a flatbed/gooseneck trailer. Semi = Class 8 tractor-trailer. */
export type DriverClass = 'hotshot' | 'semi';

export type EquipmentCode =
  | 'HS_GOOSENECK'
  | 'HS_BUMPER_PULL'
  | 'HS_DOVETAIL'
  | 'HS_CAR_HAULER'
  | 'DRY_VAN'
  | 'REEFER'
  | 'FLATBED'
  | 'STEP_DECK'
  | 'RGN'
  | 'CONESTOGA'
  | 'TANKER'
  | 'POWER_ONLY';

export type Endorsement = 'hazmat' | 'tanker' | 'doubles_triples' | 'twic';

export type LoadStatus = 'open' | 'booked' | 'in_transit' | 'delivered' | 'cancelled';
export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'cancelled';
/** instant = first eligible driver to book gets it; request = shipper reviews and accepts a request. */
export type BookingMode = 'instant' | 'request';
export type LoadSize = 'full' | 'partial';

export interface City {
  id: string; // slug, e.g. "dallas-tx"
  name: string;
  state: string; // two-letter USPS code
  lat: number;
  lng: number;
  population?: number;
}

/** A resolved location attached to a profile or load. */
export interface Place {
  cityId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  company: string | null;
  phone: string | null;
  createdAt: string;
}

export interface DriverProfile {
  userId: string;
  driverClass: DriverClass;
  equipmentTypes: EquipmentCode[];
  trailerLengthFt: number;
  maxPayloadLbs: number;
  truckDescription: string; // e.g. "2022 Ram 3500 dually + 40' PJ gooseneck"
  mcNumber: string | null;
  dotNumber: string | null;
  hasCdl: boolean;
  cdlClass: 'A' | 'B' | null;
  endorsements: Endorsement[];
  teamDriver: boolean;
  currentLocation: Place | null;
  homeBase: Place | null;
  available: boolean;
  availableFrom: string | null;
  maxDeadheadMiles: number;
  minRatePerMile: number; // USD per loaded+deadhead mile the driver is willing to accept
  preferredStates: string[];
  avoidStates: string[];
  mpg: number;
  fuelPricePerGallon: number;
  rating: number; // 0..5
  completedLoads: number;
  /** True once the driver has picked equipment, capacity and a current location. */
  profileComplete: boolean;
  updatedAt: string;
}

export interface Load {
  id: string;
  shipperId: string;
  shipperName: string;
  shipperCompany: string | null;
  status: LoadStatus;
  origin: Place;
  destination: Place;
  pickupStart: string;
  pickupEnd: string;
  deliveryBy: string | null;
  /** Equipment the shipper will accept. A load can accept both hotshot and semi equipment. */
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
  /** Estimated loaded road miles origin -> destination. */
  miles: number;
  /** rateUsd / miles, rounded to cents. */
  ratePerMile: number;
  bookingMode: BookingMode;
  referenceNumber: string | null;
  bookedDriverId: string | null;
  bookedRateUsd: number | null;
  /** Pending booking requests. Only populated for the owning shipper; 0 otherwise. */
  pendingRequestCount: number;
  createdAt: string;
  updatedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

export type MatchCheckKey =
  | 'status'
  | 'equipment'
  | 'weight'
  | 'length'
  | 'cdl'
  | 'hazmat'
  | 'tanker'
  | 'team'
  | 'avoid_state'
  | 'deadhead'
  | 'timing'
  | 'rate';

export interface MatchCheck {
  key: MatchCheckKey;
  ok: boolean;
  /** A failed hard check makes the load ineligible for this driver. */
  hard: boolean;
  label: string;
}

export interface MatchBreakdown {
  deadhead: number; // each component 0..100
  rate: number;
  fit: number;
  timing: number;
  lane: number;
}

export interface MatchResult {
  eligible: boolean;
  /** 0..100, 0 when not eligible. */
  score: number;
  /** Road miles from the driver's current location to pickup; null when the driver has no location. */
  deadheadMiles: number | null;
  loadedMiles: number;
  totalMiles: number;
  /** rateUsd / (loaded + deadhead miles). */
  effectiveRatePerMile: number;
  fuelCostUsd: number;
  /** rateUsd minus fuel for loaded + deadhead miles. */
  estimatedProfitUsd: number;
  matchedEquipment: EquipmentCode[];
  checks: MatchCheck[];
  /** Short positive call-outs, e.g. "Heads toward home". */
  highlights: string[];
  breakdown: MatchBreakdown;
}

export interface LoadWithMatch extends Load {
  /** Present for drivers (null if the driver has no profile yet); null for shippers. */
  match: MatchResult | null;
}

export type LoadSort = 'best' | 'rate' | 'deadhead' | 'pickup' | 'newest' | 'profit';

export interface LoadSearchFilters {
  q?: string;
  equipment?: EquipmentCode[];
  originCityId?: string;
  originRadiusMiles?: number;
  destinationStates?: string[];
  minRatePerMile?: number;
  maxWeightLbs?: number;
  pickupFrom?: string;
  pickupTo?: string;
  hazmat?: boolean;
  /** Also return loads this driver is not eligible for (with match.eligible = false). */
  includeIneligible?: boolean;
  sort?: LoadSort;
}

export interface DriverSummary {
  userId: string;
  name: string;
  company: string | null;
  phone: string | null;
  driverClass: DriverClass;
  equipmentTypes: EquipmentCode[];
  trailerLengthFt: number;
  maxPayloadLbs: number;
  truckDescription: string;
  hasCdl: boolean;
  endorsements: Endorsement[];
  mcNumber: string | null;
  dotNumber: string | null;
  rating: number;
  completedLoads: number;
  currentLocation: Place | null;
  available: boolean;
}

export interface Booking {
  id: string;
  loadId: string;
  driverId: string;
  status: BookingStatus;
  /** Counter-offer from the driver; null = accepts the posted rate. */
  offerRateUsd: number | null;
  message: string;
  createdAt: string;
  updatedAt: string;
  driver?: DriverSummary;
  load?: Load;
  /** How well the load fits this driver, computed when the booking is listed for a shipper. */
  match?: MatchResult | null;
}

export interface RecommendedDriver {
  driver: DriverSummary;
  match: MatchResult;
}

export interface Message {
  id: string;
  loadId: string;
  driverId: string; // the driver side of the conversation
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface Thread {
  loadId: string;
  driverId: string;
  load: Pick<Load, 'id' | 'origin' | 'destination' | 'status' | 'pickupStart' | 'rateUsd' | 'commodity'>;
  counterpart: { id: string; name: string; company: string | null; role: Role };
  lastMessage: Message | null;
  unreadCount: number;
}

export type NotificationType =
  | 'load_match'
  | 'booking_request'
  | 'booking_accepted'
  | 'booking_declined'
  | 'booking_withdrawn'
  | 'load_booked'
  | 'load_status'
  | 'load_cancelled'
  | 'message';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Client route to open, e.g. "/driver/loads/abc". */
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: LoadSearchFilters;
  alertsEnabled: boolean;
  createdAt: string;
}

/** Events pushed over GET /api/events (Server-Sent Events, `data:` is JSON of this union). */
export type ServerEvent =
  | { type: 'hello'; userId: string }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'message'; message: Message }
  | { type: 'load_updated'; loadId: string; status: LoadStatus }
  | { type: 'booking_updated'; bookingId: string; loadId: string; status: BookingStatus };

export interface RateEstimate {
  miles: number;
  lowUsd: number;
  suggestedUsd: number;
  highUsd: number;
  ratePerMile: { low: number; suggested: number; high: number };
  basis: string;
}

export interface ShipperStats {
  open: number;
  booked: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  pendingRequests: number;
}

export interface DriverStats {
  activeLoads: number;
  pendingRequests: number;
  completedLoads: number;
  earnedUsd: number; // sum of booked rate over delivered loads
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface MeResponse {
  user: User;
  driverProfile: DriverProfile | null;
}

export interface LoadListResponse {
  loads: LoadWithMatch[];
  /** Matching loads before limit/offset. */
  total: number;
  /** For drivers: false until the rig profile is filled in (matches are then null). */
  driverProfileComplete: boolean;
}

export interface LoadDetailResponse {
  load: LoadWithMatch;
  /** The signed-in driver's live or most recent booking on this load. */
  myBooking: Booking | null;
  /** The assigned driver. Visible to the owning shipper and to that driver. */
  bookedDriver: DriverSummary | null;
}

export interface BookLoadResponse {
  booking: Booking;
  load: Load;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

export interface MetaResponse {
  equipment: import('./equipment').EquipmentInfo[];
  driverClasses: import('./equipment').DriverClassInfo[];
  states: { code: string; name: string }[];
}
