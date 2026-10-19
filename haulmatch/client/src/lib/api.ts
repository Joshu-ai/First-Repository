// Typed client for the HaulMatch API (docs/SPEC.md). Every function maps to one endpoint.
import { CSRF_HEADER, CSRF_VALUE } from '../../../shared/api';
import type {
  ApiErrorBody,
  BookLoadResponse,
  Booking,
  BookingStatus,
  BookingMode,
  City,
  DriverClass,
  DriverProfile,
  DriverStats,
  DriverSummary,
  Endorsement,
  EquipmentCode,
  Load,
  LoadDetailResponse,
  LoadListResponse,
  LoadSearchFilters,
  LoadSize,
  LoadStatus,
  LoadWithMatch,
  MeResponse,
  Message,
  MetaResponse,
  NotificationsResponse,
  RateEstimate,
  RecommendedDriver,
  Role,
  SavedSearch,
  ShipperStats,
  Thread,
} from '../../../shared/types';
import { filtersToSearchParams } from './filters';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface FieldIssue {
  path: string;
  message: string;
}

/** Error codes that belong to one form field even though the server sends no field path. */
const CODE_FIELDS: Record<string, string> = {
  email_taken: 'email',
  invalid_credentials: 'password',
};

export class ApiError extends Error {
  /** HTTP status; 0 when the request never reached the server. */
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * Field-level messages keyed by field path (`{ email: 'Invalid email' }`), from zod issues in
   * `details` (path "filters.minRatePerMile" is kept as is) and from field-specific codes.
   */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const issue of this.details as unknown[]) {
        if (isFieldIssue(issue) && issue.path && !(issue.path in out)) out[issue.path] = issue.message;
      }
    }
    const field = CODE_FIELDS[this.code];
    if (field && !(field in out)) out[field] = this.message;
    return out;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

function isFieldIssue(value: unknown): value is FieldIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FieldIssue).path === 'string' &&
    typeof (value as FieldIssue).message === 'string'
  );
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A sentence to show a person for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return 'Can’t reach HaulMatch. Check your signal and try again.';
    if (error.status >= 500) return 'Something went wrong on our end. Try again in a moment.';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  signal?: AbortSignal;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Called whenever an API call returns 401 (session expired or signed out elsewhere).
 * The auth provider uses this to drop the signed-in user. Returns an unsubscribe function.
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

type Query = Record<string, string | number | boolean | null | undefined> | URLSearchParams;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (proxy, dev server); fall through to a generic message.
  }
  const err = (body as ApiErrorBody | null)?.error;
  if (err && typeof err.code === 'string') return new ApiError(res.status, err.code, err.message, err.details);
  return new ApiError(res.status, res.status === 401 ? 'unauthorized' : 'http_error', res.statusText || `HTTP ${res.status}`);
}

/** Low-level request. Prefer the typed functions in `api` below. */
export async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = CSRF_VALUE;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network', 'Network request failed');
  }

  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401) for (const listener of unauthorizedListeners) listener();
    throw error;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) {
    throw new ApiError(res.status, 'bad_response', 'The server sent an unexpected response');
  }
  return (await res.json()) as T;
}

const get = <T>(path: string, query?: Query, opts?: RequestOptions) => request<T>('GET', withQuery(path, query), undefined, opts);
const post = <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>('POST', path, body, opts);
const put = <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts);
const patch = <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts);
const del = <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts);

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Request bodies (shapes from docs/SPEC.md)
// ---------------------------------------------------------------------------

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  company?: string;
  phone?: string;
  /** Required for drivers. */
  driverClass?: DriverClass;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateMeInput {
  name?: string;
  company?: string | null;
  phone?: string | null;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** PUT /api/drivers/me/profile accepts any subset of these. */
export interface DriverProfileUpdate {
  driverClass?: DriverClass;
  equipmentTypes?: EquipmentCode[];
  trailerLengthFt?: number;
  maxPayloadLbs?: number;
  truckDescription?: string;
  mcNumber?: string | null;
  dotNumber?: string | null;
  hasCdl?: boolean;
  cdlClass?: 'A' | 'B' | null;
  endorsements?: Endorsement[];
  teamDriver?: boolean;
  currentCityId?: string | null;
  homeCityId?: string | null;
  available?: boolean;
  availableFrom?: string | null;
  maxDeadheadMiles?: number;
  minRatePerMile?: number;
  preferredStates?: string[];
  avoidStates?: string[];
  mpg?: number;
  fuelPricePerGallon?: number;
}

export interface LocationUpdate {
  cityId: string;
  available?: boolean;
  availableFrom?: string | null;
}

export interface LoadInput {
  originCityId: string;
  destinationCityId: string;
  pickupStart: string;
  pickupEnd: string;
  deliveryBy?: string;
  equipmentTypes: EquipmentCode[];
  weightLbs: number;
  lengthFt: number;
  commodity: string;
  notes?: string;
  loadSize?: LoadSize;
  hazmat?: boolean;
  tarpRequired?: boolean;
  teamRequired?: boolean;
  rateUsd: number;
  bookingMode?: BookingMode;
  referenceNumber?: string;
}

/** PATCH /api/loads/:id: every field optional; `null` clears deliveryBy / referenceNumber. */
export type LoadUpdate = Partial<Omit<LoadInput, 'deliveryBy' | 'referenceNumber'>> & {
  deliveryBy?: string | null;
  referenceNumber?: string | null;
};

export interface BookInput {
  message?: string;
  /** Counter-offer in whole dollars; omit to take the posted rate. */
  offerRateUsd?: number;
}

export interface LoadListQuery extends LoadSearchFilters {
  limit?: number;
  offset?: number;
}

export interface SavedSearchInput {
  name: string;
  filters: LoadSearchFilters;
  alertsEnabled?: boolean;
}

export type ShipperLoadFilter = LoadStatus | 'active';

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    register: (input: RegisterInput) => post<MeResponse>('/auth/register', input),
    login: (input: LoginInput) => post<MeResponse>('/auth/login', input),
    logout: () => post<void>('/auth/logout'),
    me: (opts?: RequestOptions) => get<MeResponse>('/auth/me', undefined, opts),
    updateMe: (input: UpdateMeInput) => patch<MeResponse>('/auth/me', input),
    changePassword: (input: ChangePasswordInput) => post<void>('/auth/password', input),
  },

  drivers: {
    myProfile: (opts?: RequestOptions) => get<DriverProfile>('/drivers/me/profile', undefined, opts),
    updateMyProfile: (input: DriverProfileUpdate) => put<DriverProfile>('/drivers/me/profile', input),
    /** "I'm empty in Tulsa": move the driver and optionally flip availability. */
    updateMyLocation: (input: LocationUpdate) => patch<DriverProfile>('/drivers/me/location', input),
    myStats: (opts?: RequestOptions) => get<DriverStats>('/drivers/me/stats', undefined, opts),
    get: (driverId: string, opts?: RequestOptions) => get<DriverSummary>(`/drivers/${enc(driverId)}`, undefined, opts),
  },

  meta: {
    get: (opts?: RequestOptions) => get<MetaResponse>('/meta', undefined, opts),
    searchCities: (q: string, limit?: number, opts?: RequestOptions) => get<City[]>('/cities', { q, limit }, opts),
    city: (cityId: string, opts?: RequestOptions) => get<City>(`/cities/${enc(cityId)}`, undefined, opts),
    rateEstimate: (
      input: {
        originCityId: string;
        destinationCityId: string;
        equipment: EquipmentCode[];
        /** The freight, when known, so hotshot types never price freight no hotshot can carry. */
        weightLbs?: number | null;
        lengthFt?: number | null;
      },
      opts?: RequestOptions,
    ) =>
      get<RateEstimate>(
        '/rates/estimate',
        {
          originCityId: input.originCityId,
          destinationCityId: input.destinationCityId,
          equipment: input.equipment.join(','),
          weightLbs: input.weightLbs,
          lengthFt: input.lengthFt,
        },
        opts,
      ),
  },

  notifications: {
    list: (query: { unread?: boolean; limit?: number } = {}, opts?: RequestOptions) =>
      get<NotificationsResponse>('/notifications', { unread: query.unread ? 1 : undefined, limit: query.limit }, opts),
    /** Omit ids to mark everything read. */
    markRead: (ids?: string[]) => post<{ unreadCount: number }>('/notifications/read', ids ? { ids } : {}),
  },

  savedSearches: {
    list: (opts?: RequestOptions) => get<SavedSearch[]>('/saved-searches', undefined, opts),
    create: (input: SavedSearchInput) => post<SavedSearch>('/saved-searches', input),
    update: (id: string, input: Partial<SavedSearchInput>) => patch<SavedSearch>(`/saved-searches/${enc(id)}`, input),
    remove: (id: string) => del<void>(`/saved-searches/${enc(id)}`),
  },

  loads: {
    list: (query: LoadListQuery = {}, opts?: RequestOptions) => {
      const params = filtersToSearchParams(query);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      return get<LoadListResponse>('/loads', params, opts);
    },
    get: (id: string, opts?: RequestOptions) => get<LoadDetailResponse>(`/loads/${enc(id)}`, undefined, opts),
    create: (input: LoadInput) => post<Load>('/loads', input),
    update: (id: string, input: LoadUpdate) => patch<Load>(`/loads/${enc(id)}`, input),
    cancel: (id: string) => post<Load>(`/loads/${enc(id)}/cancel`),
    book: (id: string, input: BookInput = {}) => post<BookLoadResponse>(`/loads/${enc(id)}/book`, input),
    setStatus: (id: string, status: 'in_transit' | 'delivered') => post<Load>(`/loads/${enc(id)}/status`, { status }),
    backhauls: (id: string, opts?: RequestOptions) => get<LoadWithMatch[]>(`/loads/${enc(id)}/backhauls`, undefined, opts),
    recommendedDrivers: (id: string, opts?: RequestOptions) =>
      get<RecommendedDriver[]>(`/loads/${enc(id)}/recommended-drivers`, undefined, opts),
    invite: (id: string, input: { driverId: string; message?: string }) => post<void>(`/loads/${enc(id)}/invite`, input),
    bookings: (id: string, opts?: RequestOptions) => get<Booking[]>(`/loads/${enc(id)}/bookings`, undefined, opts),
  },

  shipper: {
    loads: (status?: ShipperLoadFilter, opts?: RequestOptions) => get<Load[]>('/shipper/loads', { status }, opts),
    stats: (opts?: RequestOptions) => get<ShipperStats>('/shipper/stats', undefined, opts),
  },

  bookings: {
    list: (status?: BookingStatus, opts?: RequestOptions) => get<Booking[]>('/bookings', { status }, opts),
    accept: (id: string) => post<BookLoadResponse>(`/bookings/${enc(id)}/accept`),
    decline: (id: string) => post<Booking>(`/bookings/${enc(id)}/decline`),
    withdraw: (id: string) => post<Booking>(`/bookings/${enc(id)}/withdraw`),
  },

  messages: {
    threads: (opts?: RequestOptions) => get<Thread[]>('/threads', undefined, opts),
    /**
     * One page of a conversation, oldest first: the newest `limit` messages (server default 100,
     * max 200), or with `before` (the id of the oldest message already shown) the ones just before
     * it. A page shorter than `limit` reaches the start. Drivers omit driverId (their own thread);
     * shippers must pass it. Reading marks nothing read: call markRead for that.
     */
    list: (loadId: string, driverId?: string, page: { before?: string; limit?: number } = {}, opts?: RequestOptions) =>
      get<Message[]>(`/loads/${enc(loadId)}/messages`, { driverId, before: page.before, limit: page.limit }, opts),
    /** 429 too_many_messages past 30 messages a minute. */
    send: (loadId: string, input: { body: string; driverId?: string }) => post<Message>(`/loads/${enc(loadId)}/messages`, input),
    /** Marks the other side's messages in this conversation read (the only way to). */
    markRead: (loadId: string, driverId?: string) =>
      post<void>(`/loads/${enc(loadId)}/messages/read`, driverId ? { driverId } : {}),
  },
};
