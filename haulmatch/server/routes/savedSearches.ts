import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { SavedSearch } from '../../shared/types';
import { currentUser, requireRole } from '../auth';
import type { AppContext } from '../context';
import { bool, transaction, type Db } from '../db';
import { filtersSchema } from '../filters';
import { HttpError, notFound, parse } from '../http';
import { toSavedSearch } from '../mappers';

export const MAX_SAVED_SEARCHES = 20;

const nameSchema = z.string().trim().min(1, 'Name this search').max(60);

const createSchema = z.object({
  name: nameSchema,
  filters: filtersSchema,
  alertsEnabled: z.boolean().default(true),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  filters: filtersSchema.optional(),
  alertsEnabled: z.boolean().optional(),
});

type Row = Record<string, unknown>;

/** 404 rather than 403 for someone else's search, so ids cannot be probed. */
function getOwnedRow(db: Db, id: string, userId: string): Row {
  const row = db.prepare('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  if (!row) throw notFound('Saved search');
  return row;
}

export function savedSearchesRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireRole('driver'));

  router.get('/', (req, res) => {
    const rows = ctx.db
      .prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(currentUser(req).id) as Row[];
    res.json(rows.map(toSavedSearch) satisfies SavedSearch[]);
  });

  router.post('/', (req, res) => {
    const userId = currentUser(req).id;
    const input = parse(createSchema, req.body);
    const id = randomUUID();
    transaction(ctx.db, () => {
      const { n } = ctx.db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').get(userId) as { n: number };
      if (n >= MAX_SAVED_SEARCHES) {
        throw new HttpError(409, 'saved_search_limit', `You can keep up to ${MAX_SAVED_SEARCHES} saved searches`);
      }
      ctx.db
        .prepare(
          'INSERT INTO saved_searches (id, user_id, name, filters, alerts_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, userId, input.name, JSON.stringify(input.filters), bool(input.alertsEnabled), ctx.now().toISOString());
    });
    res.status(201).json(toSavedSearch(getOwnedRow(ctx.db, id, userId)));
  });

  router.patch('/:id', (req, res) => {
    const userId = currentUser(req).id;
    const input = parse(updateSchema, req.body);
    const current = toSavedSearch(getOwnedRow(ctx.db, req.params.id, userId));
    ctx.db
      .prepare('UPDATE saved_searches SET name = ?, filters = ?, alerts_enabled = ? WHERE id = ? AND user_id = ?')
      .run(
        input.name ?? current.name,
        JSON.stringify(input.filters ?? current.filters),
        bool(input.alertsEnabled ?? current.alertsEnabled),
        current.id,
        userId,
      );
    res.json(toSavedSearch(getOwnedRow(ctx.db, current.id, userId)));
  });

  router.delete('/:id', (req, res) => {
    const userId = currentUser(req).id;
    getOwnedRow(ctx.db, req.params.id, userId);
    ctx.db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    res.status(204).end();
  });

  return router;
}
