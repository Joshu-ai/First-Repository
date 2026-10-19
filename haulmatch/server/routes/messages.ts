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
import { createThrottle } from '../throttle';
import { driverCanSeeLoad } from '../visibility';

type Row = Record<string, unknown>;

const PREVIEW_LENGTH = 140;
/** Messages per page of GET /loads/:loadId/messages, by default and at most. */
export const MESSAGE_PAGE_SIZE = 100;
export const MESSAGE_PAGE_MAX = 200;
/** Messages one user may send per minute, across all their conversations. */
export const MESSAGES_PER_MINUTE = 30;

const MESSAGE_SELECT = `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id`;

const driverIdSchema = z.string().trim().min(1).max(100);
const threadQuerySchema = z.object({ driverId: driverIdSchema.optional() });
const pageQuerySchema = threadQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_MAX).default(MESSAGE_PAGE_SIZE),
  /** Id of the oldest message the client already has; the page holds the messages just before it. */
  before: z.string().trim().min(1).max(100).optional(),
});
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


function resolveThread(db: Db, user: User, loadId: string, requestedDriverId: string | undefined): ThreadRef {
  const load = getLoadById(db, loadId, user.id);
  if (!load) throw notFound('Load');

  if (user.role === 'driver') {
    if (requestedDriverId !== undefined && requestedDriverId !== user.id) {
      throw forbidden('Drivers can only use their own conversations');
    }
    // Drivers can talk about any load they can see (server/visibility.ts).
    if (!driverCanSeeLoad(db, load, user.id)) throw notFound('Load');
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

/**
 * The newest `limit` messages of a thread (older than `before`, when given), returned oldest first.
 * A page shorter than `limit` reaches the start of the conversation.
 */
function threadPage(db: Db, ref: ThreadRef, limit: number, before: string | undefined): Message[] {
  const params: (string | number)[] = [ref.load.id, ref.driverId];
  let cursor = '';
  if (before !== undefined) {
    const at = db
      .prepare('SELECT created_at, rowid FROM messages WHERE id = ? AND load_id = ? AND driver_id = ?')
      .get(before, ref.load.id, ref.driverId) as { created_at: string; rowid: number } | undefined;
    if (!at) {
      throw new HttpError(400, 'validation_error', 'before: Not a message in this conversation', [
        { path: 'before', message: 'Not a message in this conversation' },
      ]);
    }
    cursor = ' AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))';
    params.push(at.created_at, at.created_at, at.rowid);
  }
  const rows = db
    .prepare(
      `${MESSAGE_SELECT} WHERE m.load_id = ? AND m.driver_id = ?${cursor} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
    )
    .all(...params, limit) as Row[];
  return rows.reverse().map(toMessage);
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
  const sent = createThrottle({ max: MESSAGES_PER_MINUTE, windowMs: 60_000, now: ctx.now });

  router.get('/threads', requireAuth, (req, res) => {
    res.json(listThreads(ctx.db, currentUser(req)));
  });

  // Reading changes nothing: a GET can be triggered cross-site, so marking read is POST .../read only.
  router.get('/loads/:loadId/messages', requireAuth, (req, res) => {
    const user = currentUser(req);
    const { driverId, limit, before } = parse(pageQuerySchema, req.query);
    const ref = resolveThread(ctx.db, user, String(req.params.loadId), driverId);
    res.json(threadPage(ctx.db, ref, limit, before));
  });

  router.post('/loads/:loadId/messages', requireAuth, (req, res) => {
    const user = currentUser(req);
    const input = parse(postSchema, req.body);
    const ref = resolveThread(ctx.db, user, String(req.params.loadId), input.driverId);
    const wait = sent.retryAfterSeconds(user.id);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, 'too_many_messages', "You're sending messages too fast. Wait a minute, then try again.");
    }
    sent.record(user.id);

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
