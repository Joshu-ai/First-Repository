import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { AppNotification, NotificationType, ServerEvent } from '../shared/types';
import type { AppContext } from './context';
import { unauthorized } from './http';
import { toNotification } from './mappers';

/** How often an idle stream is pinged (and its session re-checked). */
export const SSE_PING_MS = 25_000;

/** One open GET /api/events response and the session that opened it. */
interface Stream {
  res: Response;
  sessionHash: string;
  /** The session still exists and has not expired. Streams outlive the request that checked it. */
  sessionLive: () => boolean;
  ping?: ReturnType<typeof setInterval>;
}

const clients = new Map<string, Set<Stream>>();

function send(res: Response, event: ServerEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function forget(userId: string, stream: Stream): void {
  clearInterval(stream.ping);
  const set = clients.get(userId);
  if (!set) return;
  set.delete(stream);
  if (set.size === 0) clients.delete(userId);
}

function end(userId: string, stream: Stream): void {
  forget(userId, stream);
  stream.res.end();
}

/** Push an event to every open tab of a user. No-op if they are offline. */
export function publish(userId: string, event: ServerEvent): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const stream of [...set]) {
    // Never deliver to a session that was signed out or expired since the stream opened.
    if (stream.sessionLive()) send(stream.res, event);
    else end(userId, stream);
  }
}

/**
 * End a user's open streams whose session matches, when those sessions are signed out
 * (logout, or a password change signing out the other devices).
 */
export function closeSessionStreams(userId: string, matches: (sessionHash: string) => boolean): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const stream of [...set]) if (matches(stream.sessionHash)) end(userId, stream);
}

export function connectedClientCount(userId: string): number {
  return clients.get(userId)?.size ?? 0;
}

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
}

/** Store a notification and push it live. */
export function notify(ctx: AppContext, userId: string, input: NotifyInput): AppNotification {
  const id = randomUUID();
  const createdAt = ctx.now().toISOString();
  ctx.db
    .prepare('INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, input.type, input.title, input.body ?? '', input.link ?? null, createdAt);
  const notification = toNotification({
    id,
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    link: input.link ?? null,
    created_at: createdAt,
    read_at: null,
  });
  publish(userId, { type: 'notification', notification });
  return notification;
}

/**
 * GET /api/events: Server-Sent Events stream for the signed-in user. The stream ends when its
 * session is signed out, and the session is re-checked on every ping and every event, so an
 * expired or deleted session stops receiving too.
 */
export function eventsHandler(ctx: AppContext): RequestHandler {
  const sessionRow = ctx.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?');
  return (req, res, next) => {
    const user = req.user;
    const sessionHash = req.sessionHash;
    if (!user || !sessionHash) return next(unauthorized());
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const stream: Stream = {
      res,
      sessionHash,
      sessionLive: () => sessionRow.get(sessionHash, user.id, ctx.now().toISOString()) !== undefined,
    };
    let set = clients.get(user.id);
    if (!set) clients.set(user.id, (set = new Set()));
    set.add(stream);
    send(res, { type: 'hello', userId: user.id });
    stream.ping = setInterval(() => {
      if (stream.sessionLive()) res.write(': ping\n\n');
      else end(user.id, stream);
    }, SSE_PING_MS);
    req.on('close', () => forget(user.id, stream));
  };
}
