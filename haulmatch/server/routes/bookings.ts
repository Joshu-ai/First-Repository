import { Router } from 'express';
import { z } from 'zod';
import { matchLoad } from '../../shared/matching';
import type {
  Booking,
  BookingStatus,
  BookLoadResponse,
  DriverProfile,
  Load,
  MatchResult,
  User,
} from '../../shared/types';
import { driverLoadLink, formatUsd, laneLabel, shipperLabel, shipperLoadLink } from '../alerts';
import { currentUser, requireAuth, requireRole } from '../auth';
import type { AppContext } from '../context';
import { transaction, type Db } from '../db';
import { notify, publish, type NotifyInput } from '../events';
import { conflict, notFound, parse } from '../http';
import { getDriverProfile, getDriverSummary, getLoadById, toBooking } from '../mappers';

type Row = Record<string, unknown>;

const BOOKING_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'cancelled'] as const satisfies readonly BookingStatus[];

const listQuerySchema = z.object({ status: z.enum(BOOKING_STATUSES).optional() });

// ---- Shared freight state changes (also used by routes/loads.ts) ----

/**
 * Notifications and live pushes collected while a transaction runs and sent once it commits,
 * so a change that rolls back never reaches anyone.
 */
export interface Outbox {
  notify(userId: string, input: NotifyInput): void;
  loadUpdated(load: Pick<Load, 'id' | 'status'>, userIds: string[]): void;
  bookingUpdated(booking: Pick<Booking, 'id' | 'loadId' | 'status'>, userIds: string[]): void;
}

/** Run fn in one transaction, then deliver everything it queued in the outbox. */
export function commit<T>(ctx: AppContext, fn: (outbox: Outbox) => T): T {
  const effects: (() => void)[] = [];
  const toEach = (userIds: string[], send: (userId: string) => void) => {
    for (const userId of new Set(userIds)) send(userId);
  };
  const outbox: Outbox = {
    notify: (userId, input) => effects.push(() => notify(ctx, userId, input)),
    loadUpdated: ({ id, status }, userIds) =>
      effects.push(() => toEach(userIds, (u) => publish(u, { type: 'load_updated', loadId: id, status }))),
    bookingUpdated: ({ id, loadId, status }, userIds) =>
      effects.push(() =>
        toEach(userIds, (u) => publish(u, { type: 'booking_updated', bookingId: id, loadId, status })),
      ),
  };
  const result = transaction(ctx.db, () => fn(outbox));
  for (const effect of effects) effect();
  return result;
}

export function getBooking(db: Db, id: string): Booking | null {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Row | undefined;
  return row ? toBooking(row) : null;
}

export function setBookingStatus(ctx: AppContext, booking: Booking, status: BookingStatus): Booking {
  const updatedAt = ctx.now().toISOString();
  ctx.db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, booking.id);
  return { ...booking, status, updatedAt };
}

/** The load as it is right now; used inside transactions to re-check state. */
export function freshLoad(db: Db, id: string): Load {
  const load = getLoadById(db, id);
  if (!load) throw notFound('Load');
  return load;
}

/**
 * Assign the load to the booking's driver and turn away everyone else still waiting on it.
 * The caller has already marked the booking accepted.
 */
export function markLoadBooked(ctx: AppContext, outbox: Outbox, load: Load, booking: Booking, rateUsd: number): void {
  ctx.db
    .prepare(
      `UPDATE loads SET status = 'booked', booked_driver_id = ?, booked_rate_usd = ?, updated_at = ? WHERE id = ?`,
    )
    .run(booking.driverId, rateUsd, ctx.now().toISOString(), load.id);
  const booked = { id: load.id, status: 'booked' as const };
  outbox.loadUpdated(booked, [load.shipperId, booking.driverId]);

  const others = ctx.db
    .prepare(`SELECT * FROM bookings WHERE load_id = ? AND status = 'pending' AND id != ?`)
    .all(load.id, booking.id) as Row[];
  for (const row of others) {
    const declined = setBookingStatus(ctx, toBooking(row), 'declined');
    outbox.bookingUpdated(declined, [load.shipperId, declined.driverId]);
    outbox.loadUpdated(booked, [declined.driverId]);
    outbox.notify(declined.driverId, {
      type: 'booking_declined',
      title: `Load covered: ${laneLabel(load)}`,
      body: 'Another driver booked this load. Plenty more on the board.',
      link: driverLoadLink(load.id),
    });
  }
}

/**
 * How well a load fits a driver who asked for it, for the shipper's eyes. Judged as if the load were
 * still open so accepted and declined requests keep their rig-fit score after the load is covered.
 */
export function matchForShipper(load: Load, profile: DriverProfile | null, now: Date): MatchResult | null {
  if (!profile) return null;
  return matchLoad({ ...load, status: 'open' }, profile, { now, ignoreDeadheadLimit: true });
}

/** A booking as the load's shipper sees it: with the driver (phone included) and how well they fit. */
export function withDriverAndMatch(ctx: AppContext, booking: Booking, load: Load): Booking {
  const driver = getDriverSummary(ctx.db, booking.driverId);
  const match = matchForShipper(load, getDriverProfile(ctx.db, booking.driverId), ctx.now());
  return { ...booking, ...(driver ? { driver } : {}), match };
}

// ---- Route handlers ----

interface BookingWithLoad {
  booking: Booking;
  load: Load;
}

/** 404 unless the viewer is this booking's driver or owns its load, so ids cannot be probed. */
function visibleBooking(db: Db, id: string, user: User): BookingWithLoad {
  const booking = getBooking(db, id);
  const load = booking ? getLoadById(db, booking.loadId, user.id) : null;
  if (!booking || !load) throw notFound('Booking');
  const allowed = user.role === 'driver' ? booking.driverId === user.id : load.shipperId === user.id;
  if (!allowed) throw notFound('Booking');
  return { booking, load };
}

function acceptBooking(ctx: AppContext, id: string, shipper: User): BookLoadResponse {
  commit(ctx, (outbox) => {
    const booking = getBooking(ctx.db, id);
    if (!booking) throw notFound('Booking');
    const load = freshLoad(ctx.db, booking.loadId);
    if (booking.status !== 'pending') throw conflict(`This request is ${booking.status}, not pending`);
    if (load.status !== 'open') throw conflict('This load is no longer open');

    const accepted = setBookingStatus(ctx, booking, 'accepted');
    const rateUsd = accepted.offerRateUsd ?? load.rateUsd;
    outbox.bookingUpdated(accepted, [load.shipperId, accepted.driverId]);
    markLoadBooked(ctx, outbox, load, accepted, rateUsd);
    outbox.notify(accepted.driverId, {
      type: 'booking_accepted',
      title: `You're booked: ${laneLabel(load)}`,
      body: `${shipperLabel(load)} accepted your request at ${formatUsd(rateUsd)}.`,
      link: driverLoadLink(load.id),
    });
  });
  const booking = getBooking(ctx.db, id)!;
  return { booking, load: getLoadById(ctx.db, booking.loadId, shipper.id)! };
}

function declineBooking(ctx: AppContext, id: string): Booking {
  return commit(ctx, (outbox) => {
    const booking = getBooking(ctx.db, id);
    if (!booking) throw notFound('Booking');
    if (booking.status !== 'pending') throw conflict(`This request is ${booking.status}, not pending`);
    const load = freshLoad(ctx.db, booking.loadId);
    const declined = setBookingStatus(ctx, booking, 'declined');
    outbox.bookingUpdated(declined, [load.shipperId, declined.driverId]);
    outbox.notify(declined.driverId, {
      type: 'booking_declined',
      title: `Request declined: ${laneLabel(load)}`,
      body: `${shipperLabel(load)} passed on your request this time.`,
      link: driverLoadLink(load.id),
    });
    return declined;
  });
}

function withdrawBooking(ctx: AppContext, id: string, driver: User): Booking {
  return commit(ctx, (outbox) => {
    const booking = getBooking(ctx.db, id);
    if (!booking) throw notFound('Booking');
    const load = freshLoad(ctx.db, booking.loadId);
    // An accepted booking can be dropped only until pickup; after that the freight is on the truck.
    const dropsBookedLoad =
      booking.status === 'accepted' && load.status === 'booked' && load.bookedDriverId === booking.driverId;
    if (booking.status !== 'pending' && !dropsBookedLoad) {
      throw conflict(
        booking.status === 'accepted' ? 'The load is already picked up; it can no longer be withdrawn' : `This request is already ${booking.status}`,
      );
    }

    const withdrawn = setBookingStatus(ctx, booking, 'withdrawn');
    outbox.bookingUpdated(withdrawn, [load.shipperId, driver.id]);
    if (dropsBookedLoad) {
      ctx.db
        .prepare(
          `UPDATE loads SET status = 'open', booked_driver_id = NULL, booked_rate_usd = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(ctx.now().toISOString(), load.id);
      outbox.loadUpdated({ id: load.id, status: 'open' }, [load.shipperId, driver.id]);
    }
    outbox.notify(load.shipperId, {
      type: 'booking_withdrawn',
      title: dropsBookedLoad ? `Driver dropped: ${laneLabel(load)}` : `Request withdrawn: ${laneLabel(load)}`,
      body: dropsBookedLoad
        ? `${driver.name} can no longer haul it. The load is open again.`
        : `${driver.name} withdrew their request.`,
      link: shipperLoadLink(load.id),
    });
    return withdrawn;
  });
}

function listBookings(ctx: AppContext, user: User, status: BookingStatus | undefined): Booking[] {
  const scope = user.role === 'driver' ? 'b.driver_id = ?' : 'l.shipper_id = ?';
  const params: string[] = [user.id];
  let sql = `SELECT b.* FROM bookings b JOIN loads l ON l.id = b.load_id WHERE ${scope}`;
  if (status) {
    sql += ' AND b.status = ?';
    params.push(status);
  }
  const rows = ctx.db.prepare(`${sql} ORDER BY b.created_at DESC, b.rowid DESC`).all(...params) as Row[];
  return rows.map((row) => {
    const booking = toBooking(row);
    const load = getLoadById(ctx.db, booking.loadId, user.id)!;
    return user.role === 'driver' ? { ...booking, load } : { ...withDriverAndMatch(ctx, booking, load), load };
  });
}

export function bookingsRouter(ctx: AppContext): Router {
  const router = Router();
  const shipperOnly = requireRole('shipper');
  const driverOnly = requireRole('driver');

  router.get('/', requireAuth, (req, res) => {
    const { status } = parse(listQuerySchema, req.query);
    res.json(listBookings(ctx, currentUser(req), status));
  });

  router.post('/:id/accept', shipperOnly, (req, res) => {
    const user = currentUser(req);
    visibleBooking(ctx.db, String(req.params.id), user);
    res.json(acceptBooking(ctx, String(req.params.id), user));
  });

  router.post('/:id/decline', shipperOnly, (req, res) => {
    visibleBooking(ctx.db, String(req.params.id), currentUser(req));
    res.json(declineBooking(ctx, String(req.params.id)));
  });

  router.post('/:id/withdraw', driverOnly, (req, res) => {
    const user = currentUser(req);
    visibleBooking(ctx.db, String(req.params.id), user);
    res.json(withdrawBooking(ctx, String(req.params.id), user));
  });

  return router;
}

