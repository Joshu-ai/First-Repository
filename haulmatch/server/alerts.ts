import { compareMatches, matchLoad } from '../shared/matching';
import type { DriverProfile, Load, LoadSearchFilters, MatchResult } from '../shared/types';
import type { AppContext } from './context';
import type { Db } from './db';
import { notify } from './events';
import { loadPassesFilters } from './filters';
import { getDriverProfile, toDriverProfile, toSavedSearch } from './mappers';

type Row = Record<string, unknown>;

/** Score at which an available driver hears about a new load without having a saved search for it. */
export const HOT_MATCH_MIN_SCORE = 85;
export const MAX_HOT_MATCH_ALERTS = 5;

// Notification copy shared by the alerts and the freight routes.
export const formatUsd = (usd: number): string => `$${Math.round(usd).toLocaleString('en-US')}`;
export const laneLabel = (load: Pick<Load, 'origin' | 'destination'>): string =>
  `${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}`;
export const shipperLabel = (load: Pick<Load, 'shipperCompany' | 'shipperName'>): string =>
  load.shipperCompany ?? load.shipperName;
export const driverLoadLink = (loadId: string): string => `/driver/loads/${loadId}`;
export const shipperLoadLink = (loadId: string): string => `/shipper/loads/${loadId}`;

interface AlertSearch {
  userId: string;
  name: string;
  filters: LoadSearchFilters;
}

function alertingSearches(db: Db): AlertSearch[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM saved_searches s JOIN users u ON u.id = s.user_id
       WHERE s.alerts_enabled = 1 AND u.role = 'driver'
       ORDER BY s.created_at ASC, s.rowid ASC`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const search = toSavedSearch(row);
    return { userId: String(row.user_id), name: search.name, filters: search.filters };
  });
}

/** Drivers who already got a match alert for this load, so a second run never repeats one. */
function alreadyAlerted(db: Db, loadId: string): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT user_id FROM notifications WHERE type = 'load_match' AND link = ?`)
    .all(driverLoadLink(loadId)) as { user_id: string }[];
  return new Set(rows.map((r) => r.user_id));
}

function availableProfiles(db: Db): DriverProfile[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM driver_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.available = 1 AND u.role = 'driver'`,
    )
    .all() as Row[];
  return rows.map(toDriverProfile).filter((p) => p.profileComplete);
}

const matchSummary = (match: MatchResult): string =>
  match.deadheadMiles === null ? `${match.score} match` : `${match.score} match, ${match.deadheadMiles} mi deadhead`;

/**
 * Tell drivers about a freshly posted load: everyone whose alerting saved search it fits and who
 * is eligible to haul it, plus a handful of available drivers it fits unusually well.
 * Returns how many drivers were notified.
 */
export function alertDriversForLoad(ctx: AppContext, load: Load): number {
  const now = ctx.now();
  const notified = alreadyAlerted(ctx.db, load.id);
  // The poster is a shipper today, but never alert whoever posted the load.
  notified.add(load.shipperId);
  const lane = laneLabel(load);
  const link = driverLoadLink(load.id);
  let count = 0;

  const profiles = new Map<string, DriverProfile | null>();
  const profileFor = (driverId: string): DriverProfile | null => {
    if (!profiles.has(driverId)) profiles.set(driverId, getDriverProfile(ctx.db, driverId));
    const profile = profiles.get(driverId) ?? null;
    return profile?.profileComplete ? profile : null;
  };

  for (const search of alertingSearches(ctx.db)) {
    if (notified.has(search.userId) || !loadPassesFilters(load, search.filters)) continue;
    const profile = profileFor(search.userId);
    // Same rule as the board: a search near another city scores deadhead instead of enforcing the limit.
    const ignoreDeadheadLimit = search.filters.originCityId !== undefined;
    const match = profile ? matchLoad(load, profile, { now, ignoreDeadheadLimit }) : null;
    if (!match?.eligible) continue;
    notify(ctx, search.userId, {
      type: 'load_match',
      title: `New load: ${lane} · ${formatUsd(load.rateUsd)}`,
      body: `Fits your saved search "${search.name}" · ${matchSummary(match)}`,
      link,
    });
    notified.add(search.userId);
    count += 1;
  }

  const hot = availableProfiles(ctx.db)
    .filter((p) => !notified.has(p.userId))
    .map((p) => ({ driverId: p.userId, match: matchLoad(load, p, { now }) }))
    .filter((c) => c.match.eligible && c.match.score >= HOT_MATCH_MIN_SCORE)
    .sort((a, b) => compareMatches(a.match, b.match))
    .slice(0, MAX_HOT_MATCH_ALERTS);
  for (const { driverId, match } of hot) {
    notify(ctx, driverId, {
      type: 'load_match',
      title: 'Hot match near you',
      body: `${lane} · ${formatUsd(load.rateUsd)} · ${matchSummary(match)}`,
      link,
    });
    count += 1;
  }

  return count;
}
