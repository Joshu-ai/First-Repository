import { Router } from 'express';
import { z } from 'zod';
import type { NotificationsResponse } from '../../shared/types';
import { currentUser, requireAuth } from '../auth';
import type { AppContext } from '../context';
import type { Db } from '../db';
import { eventsHandler } from '../events';
import { parse } from '../http';
import { toNotification } from '../mappers';

const listQuerySchema = z.object({
  unread: z.enum(['1', '0', 'true', 'false', '']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const markReadSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).max(500).optional(),
});

function unreadCount(db: Db, userId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as {
    n: number;
  };
  return row.n;
}

export function notificationsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/notifications', requireAuth, (req, res) => {
    const user = currentUser(req);
    const { unread, limit } = parse(listQuerySchema, req.query);
    const onlyUnread = unread === '1' || unread === 'true';
    // rowid breaks ties between notifications created in the same millisecond.
    const rows = ctx.db
      .prepare(
        `SELECT * FROM notifications WHERE user_id = ? ${onlyUnread ? 'AND read_at IS NULL' : ''}
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(user.id, limit) as Record<string, unknown>[];
    const body: NotificationsResponse = { notifications: rows.map(toNotification), unreadCount: unreadCount(ctx.db, user.id) };
    res.json(body);
  });

  router.post('/notifications/read', requireAuth, (req, res) => {
    const user = currentUser(req);
    const { ids } = parse(markReadSchema, req.body ?? {});
    const nowIso = ctx.now().toISOString();
    if (ids === undefined) {
      ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso, user.id);
    } else if (ids.length > 0) {
      ctx.db
        .prepare(
          `UPDATE notifications SET read_at = ?
           WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(nowIso, user.id, JSON.stringify(ids));
    }
    res.json({ unreadCount: unreadCount(ctx.db, user.id) });
  });

  router.get('/events', requireAuth, eventsHandler(ctx));

  return router;
}
