import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Load, Message, Thread, User } from '../../shared/types';
import { currentUser, requireAuth } from '../auth';
import type { AppContext } from '../context';
import type { Db } from '../db';
import { notify, publish } from '../events';
import { forbidden, HttpError, notFound, parse } from '../http';
import { getLoadById, getUserById, toMessage } from '../mappers';

type Row = Record<string, unknown>;

const PREVIEW_LENGTH = 140;

const MESSAGE_SELECT = `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id`;

const driverIdSchema = z.string().trim().min(1).max(100);
const threadQuerySchema = z.object({ driverId: driverIdSchema.optional() });
const postSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(2000),
  driverId: driverIdSchema.optional(),
});

/** One conversation: a load and the driver on the other side of it from the load's shipper. */
interface ThreadRef {
  load: Load;
  driverId: string;
  /** The participant who is not the signed-in user. */
  counterpartId: string;
}

const exists = (db: Db, sql: string, ...params: string[]) => db.prepare(sql).get(...params) !== undefined;

/**
 * Drivers can talk about any load they can see: open loads, loads they are booked on or have
 * requested, plus loads where they are already in a thread, so they can still answer a shipper
 * after the load is covered.
 */
function driverCanSee(db: Db, load: Load, driverId: string): boolean {
  return (
    load.status === 'open' ||
    load.bookedDriverId === driverId ||
    exists(db, 'SELECT 1 FROM bookings WHERE load_id = ? AND driver_id = ?', load.id, driverId) ||
    exists(db, 'SELECT 1 FROM messages WHERE load_id = ? AND driver_id = ? LIMIT 1', load.id, driverId)
  );
}

function resolveThread(db: Db, user: User, loadId: string, requestedDriverId: string | undefined): ThreadRef {
  const load = getLoadById(db, loadId, user.id);
  if (!load) throw notFound('Load');

  if (user.role === 'driver') {
    if (requestedDriverId !== undefined && requestedDriverId !== user.id) {
      throw forbidden('Drivers can only use their own conversations');
    }
    if (!driverCanSee(db, load, user.id)) throw notFound('Load');
    return { load, driverId: user.id, counterpartId: load.shipperId };
  }

  if (load.shipperId !== user.id) {
    // Open loads are public, so say why; anything else stays invisible.
    if (load.status === 'open') throw forbidden('You can only message about your own loads');
    throw notFound('Load');
  }
  if (requestedDriverId === undefined) {
    throw new HttpError(400, 'validation_error', 'driverId: Pick the driver to message', [
      { path: 'driverId', message: 'Pick the driver to message' },
    ]);
  }
  const driver = getUserById(db, requestedDriverId);
  if (!driver || driver.role !== 'driver') throw notFound('Driver');
  return { load, driverId: driver.id, counterpartId: driver.id };
}

function markThreadRead(ctx: AppContext, ref: ThreadRef, readerId: string): void {
  ctx.db
    .prepare(
      `UPDATE messages SET read_at = ?
       WHERE load_id = ? AND driver_id = ? AND sender_id != ? AND read_at IS NULL`,
    )
    .run(ctx.now().toISOString(), ref.load.id, ref.driverId, readerId);
}

function getMessage(db: Db, id: string): Message {
  return toMessage(db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) as Row);
}

function threadSummary(db: Db, viewer: User, loadId: string, driverId: string, unreadCount: number): Thread | null {
  const load = getLoadById(db, loadId, viewer.id);
  if (!load) return null;
  const counterpart = getUserById(db, viewer.role === 'driver' ? load.shipperId : driverId);
  if (!counterpart) return null;
  const last = db
    .prepare(`${MESSAGE_SELECT} WHERE m.load_id = ? AND m.driver_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`)
    .get(loadId, driverId) as Row | undefined;
  return {
    loadId,
    driverId,
    load: {
      id: load.id,
      origin: load.origin,
      destination: load.destination,
      status: load.status,
      pickupStart: load.pickupStart,
      rateUsd: load.rateUsd,
      commodity: load.commodity,
    },
    counterpart: { id: counterpart.id, name: counterpart.name, company: counterpart.company, role: counterpart.role },
    lastMessage: last ? toMessage(last) : null,
    unreadCount,
  };
}

function listThreads(db: Db, viewer: User): Thread[] {
  const scope = viewer.role === 'driver' ? 'm.driver_id = ?' : 'l.shipper_id = ?';
  const rows = db
    .prepare(
      `SELECT m.load_id, m.driver_id, MAX(m.created_at) AS last_at, MAX(m.rowid) AS last_rowid,
         SUM(CASE WHEN m.sender_id != ? AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread
       FROM messages m JOIN loads l ON l.id = m.load_id
       WHERE ${scope}
       GROUP BY m.load_id, m.driver_id
       ORDER BY last_at DESC, last_rowid DESC`,
    )
    .all(viewer.id, viewer.id) as { load_id: string; driver_id: string; unread: number }[];
  return rows
    .map((r) => threadSummary(db, viewer, r.load_id, r.driver_id, Number(r.unread)))
    .filter((t): t is Thread => t !== null);
}

function preview(text: string): string {
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

export function messagesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/threads', requireAuth, (req, res) => {
    res.json(listThreads(ctx.db, currentUser(req)));
  });

  router.get('/loads/:loadId/messages', requireAuth, (req, res) => {
    const user = currentUser(req);
    const { driverId } = parse(threadQuerySchema, req.query);
    const ref = resolveThread(ctx.db, user, String(req.params.loadId), driverId);
    markThreadRead(ctx, ref, user.id);
    const rows = ctx.db
      .prepare(`${MESSAGE_SELECT} WHERE m.load_id = ? AND m.driver_id = ? ORDER BY m.created_at ASC, m.rowid ASC`)
      .all(ref.load.id, ref.driverId) as Row[];
    res.json(rows.map(toMessage));
  });

  router.post('/loads/:loadId/messages', requireAuth, (req, res) => {
    const user = currentUser(req);
    const input = parse(postSchema, req.body);
    const ref = resolveThread(ctx.db, user, String(req.params.loadId), input.driverId);

    const id = randomUUID();
    ctx.db
      .prepare('INSERT INTO messages (id, load_id, driver_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ref.load.id, ref.driverId, user.id, input.body, ctx.now().toISOString());
    const message = getMessage(ctx.db, id);

    // Both sides get the event so the sender's other open tabs show the message too.
    publish(ref.load.shipperId, { type: 'message', message });
    publish(ref.driverId, { type: 'message', message });
    const lane = `${ref.load.origin.city}, ${ref.load.origin.state} → ${ref.load.destination.city}, ${ref.load.destination.state}`;
    notify(ctx, ref.counterpartId, {
      type: 'message',
      title: `Message from ${user.role === 'shipper' ? (user.company ?? user.name) : user.name}`,
      body: `${lane}: ${preview(input.body)}`,
      link: `/messages/${ref.load.id}/${ref.driverId}`,
    });

    res.status(201).json(message);
  });

  router.post('/loads/:loadId/messages/read', requireAuth, (req, res) => {
    const user = currentUser(req);
    const { driverId } = parse(threadQuerySchema, req.body ?? {});
    markThreadRead(ctx, resolveThread(ctx.db, user, String(req.params.loadId), driverId), user.id);
    res.status(204).end();
  });

  return router;
}
