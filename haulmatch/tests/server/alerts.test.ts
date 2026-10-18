import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { matchLoad } from '../../shared/matching';
import type { Load, LoadSearchFilters } from '../../shared/types';
import { alertDriversForLoad, HOT_MATCH_MIN_SCORE, MAX_HOT_MATCH_ALERTS } from '../../server/alerts';
import type { AppContext } from '../../server/context';
import { bool } from '../../server/db';
import { getDriverProfile } from '../../server/mappers';
import { createTestApp, insertLoad, seedUser, type TestApp } from '../helpers';

type Seeded = ReturnType<typeof seedUser>;

interface StoredNotification {
  type: string;
  title: string;
  body: string;
  link: string | null;
}

const notificationsFor = (t: TestApp, userId: string) =>
  t.db
    .prepare('SELECT type, title, body, link FROM notifications WHERE user_id = ? ORDER BY created_at, rowid')
    .all(userId) as unknown as StoredNotification[];

function saveSearch(t: TestApp, userId: string, name: string, filters: LoadSearchFilters, alertsEnabled = true): void {
  t.db
    .prepare('INSERT INTO saved_searches (id, user_id, name, filters, alerts_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, name, JSON.stringify(filters), bool(alertsEnabled), t.clock.now().toISOString());
}

const ctxOf = (t: TestApp): AppContext => ({ db: t.db, now: t.clock.now });

const scoreOf = (t: TestApp, load: Load, driverId: string) =>
  matchLoad(load, getDriverProfile(t.db, driverId)!, { now: t.clock.now() });

describe('alertDriversForLoad', () => {
  let t: TestApp;
  let shipper: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
  });

  /** Parked in Beaumont: eligible for a Houston pickup, but too far out for a hot match. */
  const farishDriver = () => seedUser(t, { role: 'driver', driver: { currentCityId: 'beaumont-tx' } });

  it('alerts drivers whose saved search fits the load and who can haul it', async () => {
    const driver = farishDriver();
    saveSearch(t, driver.user.id, 'Permian runs', { destinationStates: ['TX'], equipment: ['HS_GOOSENECK'] });
    const load = insertLoad(t, shipper.user.id);
    expect(scoreOf(t, load, driver.user.id).score).toBeLessThan(HOT_MATCH_MIN_SCORE);

    expect(alertDriversForLoad(ctxOf(t), load)).toBe(1);
    const [note] = notificationsFor(t, driver.user.id);
    expect(note).toEqual({
      type: 'load_match',
      title: 'New load: Houston, TX → Odessa, TX · $1,400',
      body: expect.stringContaining('Fits your saved search "Permian runs"'),
      link: `/driver/loads/${load.id}`,
    });
    expect(notificationsFor(t, shipper.user.id)).toEqual([]);
  });

  it('skips searches with alerts off, searches the load does not fit, and drivers who cannot haul it', async () => {
    const alertsOff = farishDriver();
    saveSearch(t, alertsOff.user.id, 'Quiet', {}, false);
    const wrongState = farishDriver();
    saveSearch(t, wrongState.user.id, 'Oklahoma only', { destinationStates: ['OK'] });
    const wrongTrailer = farishDriver();
    saveSearch(t, wrongTrailer.user.id, 'Vans', { equipment: ['DRY_VAN'] });
    const tooHeavy = seedUser(t, { role: 'driver', driver: { currentCityId: 'beaumont-tx', maxPayloadLbs: 5_000 } });
    saveSearch(t, tooHeavy.user.id, 'Anything', {});
    const noLocation = seedUser(t, { role: 'driver', driver: { currentCityId: null } });
    saveSearch(t, noLocation.user.id, 'Anything', {});
    const pricey = farishDriver();
    saveSearch(t, pricey.user.id, 'Big money', { minRatePerMile: 5 });

    const load = insertLoad(t, shipper.user.id);
    expect(alertDriversForLoad(ctxOf(t), load)).toBe(0);
    for (const d of [alertsOff, wrongState, wrongTrailer, tooHeavy, noLocation, pricey]) {
      expect(notificationsFor(t, d.user.id)).toEqual([]);
    }
  });

  it('respects the deadhead limit for saved-search alerts', async () => {
    const dallas = seedUser(t, { role: 'driver', driver: { currentCityId: 'dallas-tx' } });
    saveSearch(t, dallas.user.id, 'Anything', {});
    expect(alertDriversForLoad(ctxOf(t), insertLoad(t, shipper.user.id))).toBe(0);
  });

  it('lets a search for pickups near another city reach past the deadhead limit, like the board', async () => {
    const dallas = seedUser(t, { role: 'driver', driver: { currentCityId: 'dallas-tx' } });
    saveSearch(t, dallas.user.id, 'Next run out of Houston', { originCityId: 'houston-tx', originRadiusMiles: 50 });
    const load = insertLoad(t, shipper.user.id);
    expect(alertDriversForLoad(ctxOf(t), load)).toBe(1);
    expect(notificationsFor(t, dallas.user.id)[0].body).toContain('"Next run out of Houston"');
  });

  it('alerts off-duty drivers through their saved searches', async () => {
    const offDuty = seedUser(t, { role: 'driver', driver: { currentCityId: 'beaumont-tx', available: false } });
    saveSearch(t, offDuty.user.id, 'Keep me posted', {});
    expect(alertDriversForLoad(ctxOf(t), insertLoad(t, shipper.user.id))).toBe(1);
  });

  it('notifies a driver once even when several searches and a hot match all fit', async () => {
    const driver = seedUser(t, { role: 'driver' });
    saveSearch(t, driver.user.id, 'Texas', { destinationStates: ['TX'] });
    saveSearch(t, driver.user.id, 'Pipe', { q: 'pipe' });
    const load = insertLoad(t, shipper.user.id);
    expect(scoreOf(t, load, driver.user.id).score).toBeGreaterThanOrEqual(HOT_MATCH_MIN_SCORE);

    expect(alertDriversForLoad(ctxOf(t), load)).toBe(1);
    const notes = notificationsFor(t, driver.user.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('"Texas"');
  });

  it('sends hot matches to the best few available drivers', async () => {
    const cities = ['houston-tx', 'houston-tx', 'pasadena-tx', 'sugar-land-tx', 'baytown-tx', 'pasadena-tx', 'baytown-tx'];
    const hot = cities.map((currentCityId) => seedUser(t, { role: 'driver', driver: { currentCityId } }));
    const offDuty = seedUser(t, { role: 'driver', driver: { available: false } });
    const cool = farishDriver();
    const load = insertLoad(t, shipper.user.id);

    const scores = new Map(hot.map((d) => [d.user.id, scoreOf(t, load, d.user.id).score]));
    expect([...scores.values()].every((s) => s >= HOT_MATCH_MIN_SCORE)).toBe(true);
    expect(scoreOf(t, load, cool.user.id)).toMatchObject({ eligible: true });
    expect(scoreOf(t, load, cool.user.id).score).toBeLessThan(HOT_MATCH_MIN_SCORE);

    expect(alertDriversForLoad(ctxOf(t), load)).toBe(MAX_HOT_MATCH_ALERTS);
    const alerted = hot.filter((d) => notificationsFor(t, d.user.id).length > 0);
    const skipped = hot.filter((d) => notificationsFor(t, d.user.id).length === 0);
    expect(alerted).toHaveLength(MAX_HOT_MATCH_ALERTS);
    const lowestAlerted = Math.min(...alerted.map((d) => scores.get(d.user.id)!));
    expect(skipped.every((d) => scores.get(d.user.id)! <= lowestAlerted)).toBe(true);

    const [note] = notificationsFor(t, alerted[0].user.id);
    expect(note).toMatchObject({ type: 'load_match', title: 'Hot match near you', link: `/driver/loads/${load.id}` });
    expect(note.body).toContain('Houston, TX → Odessa, TX · $1,400');
    expect(notificationsFor(t, offDuty.user.id)).toEqual([]);
    expect(notificationsFor(t, cool.user.id)).toEqual([]);
  });

  it('gives saved-search drivers their alert without using up a hot-match slot', async () => {
    const searchers = Array.from({ length: 2 }, () => seedUser(t, { role: 'driver' }));
    for (const s of searchers) saveSearch(t, s.user.id, 'Anything', {});
    const others = Array.from({ length: 6 }, () => seedUser(t, { role: 'driver' }));
    const load = insertLoad(t, shipper.user.id);

    expect(alertDriversForLoad(ctxOf(t), load)).toBe(2 + MAX_HOT_MATCH_ALERTS);
    for (const s of searchers) expect(notificationsFor(t, s.user.id)[0].title).toMatch(/^New load:/);
    expect(others.filter((d) => notificationsFor(t, d.user.id).length === 1)).toHaveLength(MAX_HOT_MATCH_ALERTS);
  });

  it('never alerts a driver twice for the same load, even across runs', async () => {
    const driver = seedUser(t, { role: 'driver' });
    saveSearch(t, driver.user.id, 'Anything', {});
    const load = insertLoad(t, shipper.user.id);
    expect(alertDriversForLoad(ctxOf(t), load)).toBe(1);
    expect(alertDriversForLoad(ctxOf(t), load)).toBe(0);
    expect(notificationsFor(t, driver.user.id)).toHaveLength(1);
  });

  it('never alerts whoever posted the load', async () => {
    const driver = seedUser(t, { role: 'driver' });
    saveSearch(t, driver.user.id, 'Anything', {});
    const load = insertLoad(t, shipper.user.id);
    expect(alertDriversForLoad(ctxOf(t), { ...load, shipperId: driver.user.id })).toBe(0);
    expect(notificationsFor(t, driver.user.id)).toEqual([]);
  });

  it('runs when a shipper posts a load through the API', async () => {
    const searcher = farishDriver();
    saveSearch(t, searcher.user.id, 'West Texas', { destinationStates: ['TX'] });
    const hot = seedUser(t, { role: 'driver' });
    const res = await shipper.c.post('/api/loads', {
      originCityId: 'houston-tx',
      destinationCityId: 'odessa-tx',
      pickupStart: '2026-10-19T08:00:00Z',
      pickupEnd: '2026-10-19T18:00:00Z',
      equipmentTypes: ['HS_GOOSENECK'],
      weightLbs: 9_000,
      lengthFt: 30,
      commodity: 'Drill pipe',
      rateUsd: 1_400,
    });
    expect(res.status).toBe(201);
    const link = `/driver/loads/${res.body.id}`;
    expect(notificationsFor(t, searcher.user.id)).toEqual([expect.objectContaining({ title: 'New load: Houston, TX → Odessa, TX · $1,400', link })]);
    expect(notificationsFor(t, hot.user.id)).toEqual([expect.objectContaining({ title: 'Hot match near you', link })]);
  });
});
