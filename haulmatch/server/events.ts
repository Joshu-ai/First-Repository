import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { AppNotification, NotificationType, ServerEvent } from '../shared/types';
import type { AppContext } from './context';
import { unauthorized } from './http';
import { toNotification } from './mappers';

const clients = new Map<string, Set<Response>>();

function send(res: Response, event: ServerEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Push an event to every open tab of a user. No-op if they are offline. */
export function publish(userId: string, event: ServerEvent): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const res of set) send(res, event);
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

/** GET /api/events: Server-Sent Events stream for the signed-in user. */
export const eventsHandler: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) return next(unauthorized());
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  let set = clients.get(user.id);
  if (!set) clients.set(user.id, (set = new Set()));
  set.add(res);
  send(res, { type: 'hello', userId: user.id });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0) clients.delete(user.id);
  });
};
