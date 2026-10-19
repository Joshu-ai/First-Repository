import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getCity, placeForCityId } from '../../shared/cities';
import { EQUIPMENT_CODES } from '../../shared/equipment';
import { roadMiles, transitHours } from '../../shared/geo';
import { compareMatches, matchLoad } from '../../shared/matching';
import type {
  BookLoadResponse,
  Booking,
  DriverProfile,
  Load,
  LoadDetailResponse,
  LoadListResponse,
  LoadSort,
  LoadStatus,
  LoadWithMatch,
  RecommendedDriver,
  User,
} from '../../shared/types';
import {
  alertDriversForLoad,
  driverLoadLink,
  formatUsd,
  laneLabel,
  shipperLabel,
  shipperLoadLink,
} from '../alerts';
import { currentUser, requireAuth, requireRole } from '../auth';
import type { AppContext } from '../context';
import { bool, type Db } from '../db';
import { notify } from '../events';
import { equipmentCodeSchema, isoDateSchema, loadPassesFilters, parseFilterQuery } from '../filters';
import { conflict, forbidden, HttpError, notFound, parse } from '../http';
import {
  getDriverProfile,
  getDriverSummary,
  getLoadById,
  getUserById,
  LOAD_SELECT,
  toBooking,
  toDriverProfile,
  toDriverSummary,
  toLoad,
} from '../mappers';
import {
  commit,
  freshLoad,
  getBooking,
  markLoadBooked,
  withDriverAndMatch,
} from './bookings';
import { shipperKnowsDriver } from './drivers';

type Row = Record<string, unknown>;

const HOUR_MS = 3_600_000;
const BACKHAUL_RADIUS_MILES = 150;
const MAX_BACKHAULS = 10;
const MAX_RECOMMENDED_DRIVERS = 20;
/** SQLITE_CONSTRAINT_UNIQUE: the partial index allowing one live booking per driver per load. */
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const unique = <T>(values: T[]): T[] => [...new Set(values)];
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const cityIdSchema = z.string().refine((id) => getCity(id) !== undefined, 'Unknown city');
const dateSchema = isoDateSchema.transform((s) => new Date(s).toISOString());

/** Every editable load field, all required; POST adds defaults and PATCH makes them optional. */
const loadFieldsSchema = z.object({
  originCityId: cityIdSchema,
  destinationCityId: cityIdSchema,
  pickupStart: dateSchema,
  pickupEnd: dateSchema,
  deliveryBy: dateSchema.nullable(),
  equipmentTypes: z
    .array(equipmentCodeSchema)
    .min(1, 'Pick at least one trailer type')
    .max(EQUIPMENT_CODES.length)
    .transform(unique),
  weightLbs: z.number().int().min(1).max(200_000),
  lengthFt: z.number().min(1).max(100),
  commodity: z.string().trim().min(1, 'Say what the freight is').max(120),
  notes: z.string().trim().max(2000),
  loadSize: z.enum(['full', 'partial']),
  hazmat: z.boolean(),
  tarpRequired: z.boolean(),
  teamRequired: z.boolean(),
  rateUsd: z.number().int().min(50).max(100_000),
  bookingMode: z.enum(['instant', 'request']),
  referenceNumber: z.preprocess(blankToNull, z.string().trim().max(40).nullable()),
});

type LoadFields = z.infer<typeof loadFieldsSchema>;

const createSchema = loadFieldsSchema.extend({
  deliveryBy: loadFieldsSchema.shape.deliveryBy.optional().transform((v) => v ?? null),
  notes: loadFieldsSchema.shape.notes.default(''),
  loadSize: loadFieldsSchema.shape.loadSize.default('full'),
  hazmat: z.boolean().default(false),
  tarpRequired: z.boolean().default(false),
  teamRequired: z.boolean().default(false),
  bookingMode: loadFieldsSchema.shape.bookingMode.default('request'),
  referenceNumber: loadFieldsSchema.shape.referenceNumber.optional().transform((v) => v ?? null),
});

const updateSchema = loadFieldsSchema.partial();

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const bookSchema = z.object({
  message: z.string().trim().max(500).default(''),
  offerRateUsd: z.number().int().min(50).max(100_000).nullable().optional(),
});

const statusSchema = z.object({ status: z.enum(['in_transit', 'delivered']) });

const inviteSchema = z.object({
  driverId: z.string().trim().min(1, 'Pick a driver').max(100),
  message: z.string().trim().max(500).optional(),
});

const invalidField = (path: string, message: string) =>
  new HttpError(400, 'validation_error', `${path}: ${message}`, [{ path, message }]);

const loadNotOpen = () => conflict('This load is no longer open for booking');

// ---- Visibility ----

const hasBookingOn = (db: Db, loadId: string, driverId: string) =>
  db.prepare('SELECT 1 FROM bookings WHERE load_id = ? AND driver_id = ? LIMIT 1').get(loadId, driverId) !== undefined;

/** Open loads are public to signed-in users; anything else only to the people involved in it. */
function canView(db: Db, load: Load, user: User): boolean {
  if (load.status === 'open') return true;
  if (user.role === 'shipper') return load.shipperId === user.id;
  return load.bookedDriverId === user.id || hasBookingOn(db, load.id, user.id);
}

function visibleLoad(db: Db, id: string, user: User): Load {
  const load = getLoadById(db, id, user.id);
  if (!load || !canView(db, load, user)) throw notFound('Load');
  return load;
}

function ownedLoad(db: Db, id: string, user: User): Load {
  const load = visibleLoad(db, id, user);
  if (load.shipperId !== user.id) throw forbidden('Only the shipper who posted this load can do that');
  return load;
}

// ---- Create / edit ----

function fieldsOf(load: Load): LoadFields {
  return {
    originCityId: load.origin.cityId,
    destinationCityId: load.destination.cityId,
    pickupStart: load.pickupStart,
    pickupEnd: load.pickupEnd,
    deliveryBy: load.deliveryBy,
    equipmentTypes: load.equipmentTypes,
    weightLbs: load.weightLbs,
    lengthFt: load.lengthFt,
    commodity: load.commodity,
    notes: load.notes,
    loadSize: load.loadSize,
    hazmat: load.hazmat,
    tarpRequired: load.tarpRequired,
    teamRequired: load.teamRequired,
    rateUsd: load.rateUsd,
    bookingMode: load.bookingMode,
    referenceNumber: load.referenceNumber,
  };
}

/** Cross-field rules. The future-pickup rule only applies when the pickup window is being set. */
function checkLoadRules(f: LoadFields, now: Date, checkFuturePickup: boolean): void {
  if (f.originCityId === f.destinationCityId) {
    throw invalidField('destinationCityId', 'Delivery must be in a different city than pickup');
  }
  const pickupStart = Date.parse(f.pickupStart);
  const pickupEnd = Date.parse(f.pickupEnd);
  if (pickupEnd < pickupStart) throw invalidField('pickupEnd', 'Pickup window must end after it starts');
  if (checkFuturePickup && pickupEnd <= now.getTime()) {
    throw invalidField('pickupEnd', 'Pickup window must end in the future');
  }
  if (f.deliveryBy && Date.parse(f.deliveryBy) < pickupStart) {
    throw invalidField('deliveryBy', 'Delivery deadline must be after pickup starts');
  }
}

const laneMiles = (f: LoadFields) =>
  Math.max(1, roadMiles(placeForCityId(f.originCityId)!, placeForCityId(f.destinationCityId)!));

/** Column values in the order shared by the INSERT and UPDATE statements below. */
function columnValues(f: LoadFields) {
  return [
    f.originCityId,
    f.destinationCityId,
    f.pickupStart,
    f.pickupEnd,
    f.deliveryBy,
    JSON.stringify(f.equipmentTypes),
    f.weightLbs,
    f.lengthFt,
    f.commodity,
    f.notes,
    f.loadSize,
    bool(f.hazmat),
    bool(f.tarpRequired),
    bool(f.teamRequired),
    f.rateUsd,
    laneMiles(f),
    f.bookingMode,
    f.referenceNumber,
  ];
}

function createLoad(ctx: AppContext, shipper: User, fields: LoadFields): Load {
  checkLoadRules(fields, ctx.now(), true);
  const id = randomUUID();
  const nowIso = ctx.now().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO loads (origin_city_id, dest_city_id, pickup_start, pickup_end, delivery_by, equipment_types,
        weight_lbs, length_ft, commodity, notes, load_size, hazmat, tarp_required, team_required, rate_usd, miles,
        booking_mode, reference_number, id, shipper_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(...columnValues(fields), id, shipper.id, nowIso, nowIso);
  return getLoadById(ctx.db, id, shipper.id)!;
}

function updateLoad(ctx: AppContext, load: Load, update: z.infer<typeof updateSchema>): Load {
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  commit(ctx, (outbox) => {
    const current = freshLoad(ctx.db, load.id);
    if (current.status !== 'open') throw conflict('Only open loads can be edited');
    if (Object.keys(defined).length === 0) return;
    const next: LoadFields = { ...fieldsOf(current), ...defined };
    checkLoadRules(next, ctx.now(), update.pickupStart !== undefined || update.pickupEnd !== undefined);
    ctx.db
      .prepare(
        `UPDATE loads SET origin_city_id = ?, dest_city_id = ?, pickup_start = ?, pickup_end = ?, delivery_by = ?,
          equipment_types = ?, weight_lbs = ?, length_ft = ?, commodity = ?, notes = ?, load_size = ?, hazmat = ?,
          tarp_required = ?, team_required = ?, rate_usd = ?, miles = ?, booking_mode = ?, reference_number = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(...columnValues(next), ctx.now().toISOString(), load.id);

    const waiting = pendingDriverIds(ctx.db, load.id);
    outbox.loadUpdated(current, [load.shipperId, ...waiting]);
    const lane = laneLabel({
      origin: placeForCityId(next.originCityId)!,
      destination: placeForCityId(next.destinationCityId)!,
    });
    for (const driverId of waiting) {
      outbox.notify(driverId, {
        type: 'load_status',
        title: `Load updated: ${lane}`,
        body: `${shipperLabel(current)} changed the details. Check pickup, rate and specs before you roll.`,
        link: driverLoadLink(load.id),
      });
    }
  });
  return getLoadById(ctx.db, load.id, load.shipperId)!;
}

function pendingDriverIds(db: Db, loadId: string): string[] {
  const rows = db
    .prepare(`SELECT driver_id FROM bookings WHERE load_id = ? AND status = 'pending'`)
    .all(loadId) as { driver_id: string }[];
  return rows.map((r) => r.driver_id);
}

function cancelLoad(ctx: AppContext, load: Load): Load {
  commit(ctx, (outbox) => {
    const current = freshLoad(ctx.db, load.id);
    if (current.status !== 'open' && current.status !== 'booked') {
      throw conflict(`A load that is ${current.status.replace('_', ' ')} can't be cancelled`);
    }
    const nowIso = ctx.now().toISOString();
    const live = (
      ctx.db
        .prepare(`SELECT * FROM bookings WHERE load_id = ? AND status IN ('pending', 'accepted')`)
        .all(load.id) as Row[]
    ).map(toBooking);
    ctx.db
      .prepare(
        `UPDATE loads SET status = 'cancelled', booked_driver_id = NULL, booked_rate_usd = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(nowIso, load.id);
    ctx.db
      .prepare(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE load_id = ? AND status IN ('pending', 'accepted')`)
      .run(nowIso, load.id);

    outbox.loadUpdated({ id: load.id, status: 'cancelled' }, [load.shipperId, ...live.map((b) => b.driverId)]);
    for (const booking of live) {
      outbox.bookingUpdated({ ...booking, status: 'cancelled' }, [load.shipperId, booking.driverId]);
      outbox.notify(booking.driverId, {
        type: 'load_cancelled',
        title: `Cancelled: ${laneLabel(current)}`,
        body: `${shipperLabel(current)} cancelled this load.`,
        link: driverLoadLink(load.id),
      });
    }
  });
  return getLoadById(ctx.db, load.id, load.shipperId)!;
}

// ---- Search ----

function openLoads(ctx: AppContext, viewerId: string): Load[] {
  const now = ctx.now().getTime();
  const rows = ctx.db
    .prepare(`${LOAD_SELECT} WHERE l.status = 'open' ORDER BY l.created_at DESC, l.rowid DESC`)
    .all() as Row[];
  return rows.map((row) => toLoad(row, viewerId)).filter((load) => Date.parse(load.pickupEnd) >= now);
}

const ascNullsLast = (a: number | null | undefined, b: number | null | undefined) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b;
const descNullsLast = (a: number | null | undefined, b: number | null | undefined) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a;

/** Sort comparators; ties keep the newest-first order the rows arrive in. */
const SORTS: Record<LoadSort, (a: LoadWithMatch, b: LoadWithMatch) => number> = {
  best: (a, b) => compareMatches(a.match, b.match),
  rate: (a, b) => b.ratePerMile - a.ratePerMile,
  deadhead: (a, b) => ascNullsLast(a.match?.deadheadMiles, b.match?.deadheadMiles),
  pickup: (a, b) => Date.parse(a.pickupStart) - Date.parse(b.pickupStart),
  newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  profit: (a, b) => descNullsLast(a.match?.estimatedProfitUsd, b.match?.estimatedProfitUsd),
};

function searchLoads(ctx: AppContext, user: User, query: Record<string, unknown>): LoadListResponse {
  const filters = parseFilterQuery(query);
  const { limit, offset } = parse(pageSchema, { limit: query.limit, offset: query.offset });
  const profile = user.role === 'driver' ? getDriverProfile(ctx.db, user.id) : null;
  const matchable = profile?.profileComplete ? profile : null;
  const now = ctx.now();
  // Searching pickups near another city means the driver is planning their next run from there, so
  // the deadhead from where they sit today is scored (soft) instead of hiding every load over the limit.
  const options = { now, ignoreDeadheadLimit: filters.originCityId !== undefined };

  let loads: LoadWithMatch[] = openLoads(ctx, user.id)
    .filter((load) => loadPassesFilters(load, filters))
    .map((load) => ({ ...load, match: matchable ? matchLoad(load, matchable, options) : null }));
  if (matchable && !filters.includeIneligible) loads = loads.filter((l) => l.match!.eligible);

  const sort = filters.sort ?? (user.role === 'driver' ? 'best' : 'newest');
  loads.sort(SORTS[sort]);
  return {
    loads: loads.slice(offset, offset + limit),
    total: loads.length,
    // Shippers have no rig profile, so their results never carry matches either.
    driverProfileComplete: matchable !== null,
  };
}

// ---- Detail ----

function myBookingOn(db: Db, loadId: string, driverId: string): Booking | null {
  const row = db
    .prepare(
      `SELECT * FROM bookings WHERE load_id = ? AND driver_id = ?
       ORDER BY CASE WHEN status IN ('pending', 'accepted') THEN 0 ELSE 1 END, created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(loadId, driverId) as Row | undefined;
  return row ? toBooking(row) : null;
}

function loadDetail(ctx: AppContext, load: Load, user: User): LoadDetailResponse {
  const isDriver = user.role === 'driver';
  const profile = isDriver ? getDriverProfile(ctx.db, user.id) : null;
  const match = profile?.profileComplete
    ? matchLoad(load, profile, { now: ctx.now(), ignoreDeadheadLimit: true })
    : null;
  const seesDriver = load.bookedDriverId !== null && (load.shipperId === user.id || load.bookedDriverId === user.id);
  const isBookedDriver = load.bookedDriverId === user.id;
  return {
    load: { ...load, match },
    myBooking: isDriver ? myBookingOn(ctx.db, load.id, user.id) : null,
    bookedDriver: seesDriver ? getDriverSummary(ctx.db, load.bookedDriverId!) : null,
    shipperPhone: isBookedDriver ? (getUserById(ctx.db, load.shipperId)?.phone ?? null) : null,
  };
}

// ---- Booking and the trip ----

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_UNIQUE;

function insertBooking(ctx: AppContext, booking: Omit<Booking, 'createdAt' | 'updatedAt'>): void {
  const nowIso = ctx.now().toISOString();
  try {
    ctx.db
      .prepare(
        `INSERT INTO bookings (id, load_id, driver_id, status, offer_rate_usd, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(booking.id, booking.loadId, booking.driverId, booking.status, booking.offerRateUsd, booking.message, nowIso, nowIso);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'already_requested', 'You already have a live request on this load');
    }
    throw err;
  }
}

function requireBookableProfile(db: Db, driverId: string): DriverProfile {
  const profile = getDriverProfile(db, driverId);
  if (!profile?.profileComplete) {
    throw new HttpError(422, 'profile_incomplete', 'Finish your rig profile (equipment, capacity and location) before booking');
  }
  return profile;
}

function bookLoad(ctx: AppContext, load: Load, driver: User, input: z.infer<typeof bookSchema>): BookLoadResponse {
  if (load.status !== 'open') throw loadNotOpen();
  const profile = requireBookableProfile(ctx.db, driver.id);
  const failed = matchLoad(load, profile, { now: ctx.now(), ignoreDeadheadLimit: true }).checks.filter(
    (c) => c.hard && !c.ok,
  );
  if (failed.length > 0) {
    throw new HttpError(422, 'not_eligible', `This load doesn't fit your rig: ${failed[0].label}`, failed);
  }

  // Offering exactly the posted rate is accepting it, not a counter-offer.
  const offerRateUsd = input.offerRateUsd != null && input.offerRateUsd !== load.rateUsd ? input.offerRateUsd : null;
  const instant = load.bookingMode === 'instant' && offerRateUsd === null;
  const bookingId = randomUUID();

  commit(ctx, (outbox) => {
    // Re-read inside the transaction: another driver may have booked it since the checks above.
    const current = freshLoad(ctx.db, load.id);
    if (current.status !== 'open') throw loadNotOpen();
    insertBooking(ctx, {
      id: bookingId,
      loadId: load.id,
      driverId: driver.id,
      status: instant ? 'accepted' : 'pending',
      offerRateUsd,
      message: input.message,
    });
    const booking = getBooking(ctx.db, bookingId)!;
    outbox.bookingUpdated(booking, [current.shipperId, driver.id]);
    const lane = laneLabel(current);

    if (instant) {
      markLoadBooked(ctx, outbox, current, booking, current.rateUsd);
      outbox.notify(current.shipperId, {
        type: 'load_booked',
        title: `Booked: ${lane}`,
        body: `${driver.name} booked it at ${formatUsd(current.rateUsd)}.`,
        link: shipperLoadLink(load.id),
      });
      return;
    }
    const terms = offerRateUsd
      ? `offers ${formatUsd(offerRateUsd)} (posted ${formatUsd(current.rateUsd)})`
      : `at your posted ${formatUsd(current.rateUsd)}`;
    outbox.notify(current.shipperId, {
      type: 'booking_request',
      title: `New request from ${driver.name}`,
      body: `${lane} · ${terms}${input.message ? ` · "${input.message}"` : ''}`,
      link: shipperLoadLink(load.id),
    });
  });

  return { booking: getBooking(ctx.db, bookingId)!, load: getLoadById(ctx.db, load.id, driver.id)! };
}

const NEXT_STATUS: Partial<Record<LoadStatus, LoadStatus>> = { booked: 'in_transit', in_transit: 'delivered' };

function advanceTrip(ctx: AppContext, load: Load, driver: User, status: 'in_transit' | 'delivered'): Load {
  commit(ctx, (outbox) => {
    const current = freshLoad(ctx.db, load.id);
    if (current.bookedDriverId !== driver.id) throw forbidden('Only the booked driver can update this load');
    if (NEXT_STATUS[current.status] !== status) {
      throw conflict(`A load that is ${current.status.replace('_', ' ')} can't move to ${status.replace('_', ' ')}`);
    }
    const nowIso = ctx.now().toISOString();
    const stamp = status === 'in_transit' ? 'picked_up_at' : 'delivered_at';
    ctx.db.prepare(`UPDATE loads SET status = ?, ${stamp} = ?, updated_at = ? WHERE id = ?`).run(status, nowIso, nowIso, load.id);
    if (status === 'delivered') {
      ctx.db.prepare('UPDATE driver_profiles SET completed_loads = completed_loads + 1 WHERE user_id = ?').run(driver.id);
    }
    outbox.loadUpdated({ id: load.id, status }, [current.shipperId, driver.id]);
    outbox.notify(current.shipperId, {
      type: 'load_status',
      title: `${status === 'in_transit' ? 'Picked up' : 'Delivered'}: ${laneLabel(current)}`,
      body: `${driver.name} ${status === 'in_transit' ? 'picked up the load and is rolling' : 'delivered the load'}.`,
      link: shipperLoadLink(load.id),
    });
  });
  return getLoadById(ctx.db, load.id, driver.id)!;
}

// ---- Driver and shipper helpers ----

/**
 * Open loads near this load's drop, matched as if the driver is empty there once it delivers.
 * With no delivery deadline, the drop is the run's transit time (hours-of-service breaks included)
 * after pickup closes.
 */
function backhaulsFor(ctx: AppContext, load: Load, profile: DriverProfile, viewerId: string): LoadWithMatch[] {
  const droppedAt = load.deliveryBy
    ? Date.parse(load.deliveryBy)
    : Date.parse(load.pickupEnd) + transitHours(load.miles) * HOUR_MS;
  const ownReady = profile.availableFrom ? Date.parse(profile.availableFrom) : 0;
  const atDrop: DriverProfile = {
    ...profile,
    currentLocation: load.destination,
    availableFrom: new Date(Math.max(droppedAt, ownReady)).toISOString(),
  };
  const now = ctx.now();
  return openLoads(ctx, viewerId)
    .filter((c) => c.id !== load.id && roadMiles(load.destination, c.origin) <= BACKHAUL_RADIUS_MILES)
    .map((c) => ({ ...c, match: matchLoad(c, atDrop, { now, ignoreDeadheadLimit: true }) }))
    .filter((c) => c.match.eligible)
    .sort((a, b) => compareMatches(a.match, b.match))
    .slice(0, MAX_BACKHAULS);
}

function recommendedDrivers(ctx: AppContext, load: Load): RecommendedDriver[] {
  const rows = ctx.db
    .prepare(
      `SELECT p.* FROM driver_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.available = 1 AND u.role = 'driver'
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.load_id = ? AND b.driver_id = p.user_id AND b.status IN ('pending', 'accepted')
         )`,
    )
    .all(load.id) as Row[];
  const now = ctx.now();
  return rows
    .map(toDriverProfile)
    .filter((p) => p.profileComplete)
    .map((profile) => ({ profile, match: matchLoad(load, profile, { now, ignoreDeadheadLimit: true }) }))
    .filter((c) => c.match.eligible)
    .sort((a, b) => compareMatches(a.match, b.match))
    .slice(0, MAX_RECOMMENDED_DRIVERS)
    .map(({ profile, match }) => {
      const driver = toDriverSummary(getUserById(ctx.db, profile.userId)!, profile);
      const phone = shipperKnowsDriver(ctx.db, load.shipperId, profile.userId) ? driver.phone : null;
      return { driver: { ...driver, phone }, match };
    });
}

function inviteDriver(ctx: AppContext, load: Load, input: z.infer<typeof inviteSchema>): void {
  if (load.status !== 'open') throw conflict('Only open loads can be offered to drivers');
  const driver = getUserById(ctx.db, input.driverId);
  if (!driver || driver.role !== 'driver') throw notFound('Driver');
  notify(ctx, driver.id, {
    type: 'load_match',
    title: `Invited: ${laneLabel(load)} · ${formatUsd(load.rateUsd)}`,
    body: input.message || `${shipperLabel(load)} thinks this load fits your rig.`,
    link: driverLoadLink(load.id),
  });
}

function bookingsOnLoad(ctx: AppContext, load: Load): Booking[] {
  const rows = ctx.db
    .prepare('SELECT * FROM bookings WHERE load_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(load.id) as Row[];
  return rows.map((row) => withDriverAndMatch(ctx, toBooking(row), load));
}

export function loadsRouter(ctx: AppContext): Router {
  const router = Router();
  const shipperOnly = requireRole('shipper');
  const driverOnly = requireRole('driver');

  router.get('/', requireAuth, (req, res) => {
    res.json(searchLoads(ctx, currentUser(req), req.query as Record<string, unknown>));
  });

  router.post('/', shipperOnly, (req, res) => {
    const user = currentUser(req);
    const load = createLoad(ctx, user, parse(createSchema, req.body));
    try {
      alertDriversForLoad(ctx, load);
    } catch (err) {
      // The load is already posted; failing the request now would only invite a duplicate repost.
      console.error('Load alerts failed', err);
    }
    res.status(201).json(load);
  });

  router.get('/:id', requireAuth, (req, res) => {
    const user = currentUser(req);
    res.json(loadDetail(ctx, visibleLoad(ctx.db, String(req.params.id), user), user));
  });

  router.patch('/:id', shipperOnly, (req, res) => {
    const load = ownedLoad(ctx.db, String(req.params.id), currentUser(req));
    res.json(updateLoad(ctx, load, parse(updateSchema, req.body)));
  });

  router.post('/:id/cancel', shipperOnly, (req, res) => {
    res.json(cancelLoad(ctx, ownedLoad(ctx.db, String(req.params.id), currentUser(req))));
  });

  router.post('/:id/book', driverOnly, (req, res) => {
    const user = currentUser(req);
    const input = parse(bookSchema, req.body ?? {});
    // Booking a load someone else just took is a conflict, not a missing load, so skip the visibility check.
    const load = getLoadById(ctx.db, String(req.params.id), user.id);
    if (!load) throw notFound('Load');
    res.status(201).json(bookLoad(ctx, load, user, input));
  });

  router.post('/:id/status', driverOnly, (req, res) => {
    const user = currentUser(req);
    const load = visibleLoad(ctx.db, String(req.params.id), user);
    if (load.bookedDriverId !== user.id) throw forbidden('Only the booked driver can update this load');
    const { status } = parse(statusSchema, req.body);
    res.json(advanceTrip(ctx, load, user, status));
  });

  router.get('/:id/backhauls', driverOnly, (req, res) => {
    const user = currentUser(req);
    const load = visibleLoad(ctx.db, String(req.params.id), user);
    const profile = getDriverProfile(ctx.db, user.id);
    res.json(profile ? backhaulsFor(ctx, load, profile, user.id) : []);
  });

  router.get('/:id/recommended-drivers', shipperOnly, (req, res) => {
    res.json(recommendedDrivers(ctx, ownedLoad(ctx.db, String(req.params.id), currentUser(req))));
  });

  router.post('/:id/invite', shipperOnly, (req, res) => {
    const load = ownedLoad(ctx.db, String(req.params.id), currentUser(req));
    inviteDriver(ctx, load, parse(inviteSchema, req.body));
    res.status(204).end();
  });

  router.get('/:id/bookings', shipperOnly, (req, res) => {
    res.json(bookingsOnLoad(ctx, ownedLoad(ctx.db, String(req.params.id), currentUser(req))));
  });

  return router;
}
