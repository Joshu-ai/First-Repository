import { Router } from 'express';
import { z } from 'zod';
import type { Load, LoadStatus, ShipperStats } from '../../shared/types';
import { currentUser, requireRole } from '../auth';
import type { AppContext } from '../context';
import type { Db } from '../db';
import { parse } from '../http';
import { LOAD_SELECT, toLoad } from '../mappers';

type Row = Record<string, unknown>;

const LOAD_STATUSES = ['open', 'booked', 'in_transit', 'delivered', 'cancelled'] as const satisfies readonly LoadStatus[];
/** Loads still in play: posted, covered, or on the road. */
const ACTIVE_STATUSES: LoadStatus[] = ['open', 'booked', 'in_transit'];

const loadsQuerySchema = z.object({ status: z.enum([...LOAD_STATUSES, 'active']).optional() });

function shipperLoads(db: Db, shipperId: string, status: LoadStatus | 'active' | undefined): Load[] {
  const statuses = status === 'active' ? ACTIVE_STATUSES : status ? [status] : [];
  const statusClause = statuses.length > 0 ? ` AND l.status IN (${statuses.map(() => '?').join(', ')})` : '';
  const rows = db
    .prepare(`${LOAD_SELECT} WHERE l.shipper_id = ?${statusClause} ORDER BY l.created_at DESC, l.rowid DESC`)
    .all(shipperId, ...statuses) as Row[];
  return rows.map((row) => toLoad(row, shipperId));
}

function shipperStats(db: Db, shipperId: string, now: Date): ShipperStats {
  const counts = db
    .prepare('SELECT status, COUNT(*) AS n FROM loads WHERE shipper_id = ? GROUP BY status')
    .all(shipperId) as { status: LoadStatus; n: number }[];
  const byStatus = new Map(counts.map((c) => [c.status, Number(c.n)]));
  // Open loads whose pickup window has closed are off the board (search and booking skip them).
  const { n: expired } = db
    .prepare(`SELECT COUNT(*) AS n FROM loads WHERE shipper_id = ? AND status = 'open' AND pickup_end < ?`)
    .get(shipperId, now.toISOString()) as { n: number };
  const { n: pendingRequests } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bookings b JOIN loads l ON l.id = b.load_id
       WHERE l.shipper_id = ? AND b.status = 'pending'`,
    )
    .get(shipperId) as { n: number };
  return {
    open: (byStatus.get('open') ?? 0) - Number(expired),
    expired: Number(expired),
    booked: byStatus.get('booked') ?? 0,
    inTransit: byStatus.get('in_transit') ?? 0,
    delivered: byStatus.get('delivered') ?? 0,
    cancelled: byStatus.get('cancelled') ?? 0,
    pendingRequests: Number(pendingRequests),
  };
}

export function shipperRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireRole('shipper'));

  router.get('/loads', (req, res) => {
    const { status } = parse(loadsQuerySchema, req.query);
    res.json(shipperLoads(ctx.db, currentUser(req).id, status));
  });

  router.get('/stats', (req, res) => {
    res.json(shipperStats(ctx.db, currentUser(req).id, ctx.now()));
  });

  return router;
}
