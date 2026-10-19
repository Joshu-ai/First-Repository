import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../server/auth';
import { openDb, type Db } from '../../server/db';
import { filtersSchema } from '../../server/filters';
import { getDriverProfile, getLoadById, toSavedSearch } from '../../server/mappers';
import { DEMO_EMAILS, DEMO_PASSWORD, seedDatabase, type SeedSummary } from '../../server/seed';
import { getCity } from '../../shared/cities';
import { EQUIPMENT, HOTSHOT_MAX_LENGTH_FT, HOTSHOT_MAX_PAYLOAD_LBS } from '../../shared/equipment';
import { driveHours, roadMiles } from '../../shared/geo';
import { matchLoad } from '../../shared/matching';
import { estimateRate } from '../../shared/rates';
import type { DriverProfile, EquipmentCode, Load, MatchResult } from '../../shared/types';

const NOW = new Date('2026-10-18T12:00:00.000Z');
/** An awkward clock (late evening, odd seconds, months away) to catch rules that only hold at noon. */
const ODD_NOW = new Date('2026-03-08T23:47:13.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Row = Record<string, unknown>;

function seeded(now = NOW): { db: Db; summary: SeedSummary } {
  const db = openDb(':memory:');
  return { db, summary: seedDatabase(db, { now }) };
}

const rows = (db: Db, sql: string, ...params: string[]): Row[] => db.prepare(sql).all(...params) as Row[];
const count = (db: Db, sql: string, ...params: string[]): number =>
  Number((db.prepare(sql).get(...params) as { n: number }).n);
const tableRows = (db: Db, table: string): Row[] => rows(db, `SELECT * FROM ${table} ORDER BY rowid`);
const userId = (db: Db, email: string): string =>
  String((db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id);
const hasRole = (db: Db, id: unknown, role: 'driver' | 'shipper'): boolean =>
  count(db, 'SELECT COUNT(*) AS n FROM users WHERE id = ? AND role = ?', String(id), role) === 1;
const allLoads = (db: Db): Load[] =>
  rows(db, 'SELECT id FROM loads ORDER BY id').map((r) => getLoadById(db, String(r.id))!);
const ms = (iso: string | null): number => (iso === null ? NaN : Date.parse(iso));

const SEMI_ONLY_CODES = new Set<EquipmentCode>(['DRY_VAN', 'REEFER', 'TANKER', 'DRY_BULK', 'POWER_ONLY']);
const OPEN_DECKS = new Set<EquipmentCode>(['FLATBED', 'STEP_DECK']);
const HEAVY_MACHINERY = /Excavator \(CAT|Dozer|Motor grader|Wheel loader|Combine/;
const NOTIFICATION_TYPES = new Set([
  'load_match',
  'booking_request',
  'booking_accepted',
  'booking_declined',
  'booking_withdrawn',
  'load_booked',
  'load_status',
  'load_cancelled',
  'message',
]);

const isHotshotCode = (code: EquipmentCode): boolean => EQUIPMENT[code].driverClass === 'hotshot';

/** Every rule a seeded load must satisfy; returns readable problems (empty = valid). */
function loadProblems(load: Load, now: number): string[] {
  const problems: string[] = [];
  const bad = (msg: string) =>
    problems.push(`${load.commodity} ${load.origin.cityId} -> ${load.destination.cityId} (${load.status}): ${msg}`);
  const eq = load.equipmentTypes;
  const start = ms(load.pickupStart);
  const end = ms(load.pickupEnd);
  const created = ms(load.createdAt);

  if (!getCity(load.origin.cityId) || !getCity(load.destination.cityId)) bad('unknown city');
  if (load.origin.cityId === load.destination.cityId) bad('origin equals destination');
  if (load.miles !== roadMiles(load.origin, load.destination) || load.miles < 40) bad(`miles ${load.miles}`);
  if (!(end > start)) bad('empty pickup window');
  if (load.deliveryBy !== null && ms(load.deliveryBy) < end + driveHours(load.miles) * HOUR) {
    bad('delivery deadline is sooner than the drive');
  }
  if (created > now || created > start || ms(load.updatedAt) < created) bad('timestamps out of order');

  if (eq.length === 0 || new Set(eq).size !== eq.length) bad('equipment empty or repeated');
  const hotshot = eq.some(isHotshotCode);
  if (hotshot && (load.lengthFt > HOTSHOT_MAX_LENGTH_FT || load.weightLbs > HOTSHOT_MAX_PAYLOAD_LBS)) {
    bad('too big for hotshot');
  }
  if (hotshot && eq.some((e) => SEMI_ONLY_CODES.has(e))) bad('van/reefer/tank freight offered to hotshots');
  if (hotshot && load.teamRequired) bad('team hotshot load');
  if ((eq.includes('TANKER') || eq.includes('DRY_BULK')) && eq.length > 1) bad('tank freight mixed with other equipment');
  if (/pneumatic|frac sand/i.test(load.commodity) && eq.join() !== 'DRY_BULK') bad('dry bulk not posted as DRY_BULK');
  if (load.weightLbs > Math.max(...eq.map((e) => EQUIPMENT[e].typicalPayloadLbs))) bad('heavier than any rig carries');
  if (load.lengthFt > Math.max(...eq.map((e) => EQUIPMENT[e].typicalLengthFt))) bad('longer than any accepted deck');
  if (HEAVY_MACHINERY.test(load.commodity) && !eq.includes('RGN')) bad('heavy machinery without RGN');
  if (load.hazmat !== /\bUN\d{4}\b/.test(load.commodity)) bad('hazmat flag and UN number disagree');
  if (eq.length === 1 && eq[0] === 'REEFER' && !/-?\d+°F/.test(load.notes)) bad('reefer load without a set point');
  if (load.tarpRequired && !eq.some((e) => OPEN_DECKS.has(e) || isHotshotCode(e))) bad('tarps on enclosed equipment');

  const suggested = estimateRate(load.miles, eq).suggestedUsd;
  if (load.rateUsd % 25 !== 0 || Math.abs(load.rateUsd - suggested) > suggested * 0.15 + 12.5) {
    bad(`rate ${load.rateUsd} vs suggested ${suggested}`);
  }

  const assigned = load.bookedDriverId !== null && load.bookedRateUsd !== null;
  const pickedUp = ms(load.pickedUpAt);
  const delivered = ms(load.deliveredAt);
  switch (load.status) {
    case 'open': {
      if (start < now + 2 * HOUR || end > now + 7 * DAY) bad('open pickup outside now+2h .. now+7d');
      const hours = (end - start) / HOUR;
      if (hours < 2 || hours > 10) bad(`pickup window of ${hours}h`);
      if (load.bookedDriverId || load.bookedRateUsd || load.pickedUpAt || load.deliveredAt) {
        bad('open load has a driver');
      }
      break;
    }
    case 'booked':
      if (!assigned || load.pickedUpAt || load.deliveredAt || start <= now) bad('booked load state');
      break;
    case 'in_transit':
      if (!assigned || load.deliveredAt || !(pickedUp <= now) || pickedUp < start) bad('in-transit state');
      break;
    case 'delivered':
      if (!assigned || !(pickedUp <= delivered) || delivered > now) bad('delivered state');
      break;
    case 'cancelled':
      if (load.bookedDriverId || load.pickedUpAt) bad('cancelled load has a driver');
      break;
  }
  return problems;
}

interface Board {
  profile: DriverProfile;
  matches: { load: Load; match: MatchResult }[];
}

function boardFor(db: Db, email: string, now = NOW): Board {
  const profile = getDriverProfile(db, userId(db, email))!;
  const open = allLoads(db).filter((l) => l.status === 'open');
  return { profile, matches: open.map((load) => ({ load, match: matchLoad(load, profile, { now }) })) };
}

describe('seedDatabase', () => {
  let db: Db;
  let summary: SeedSummary;

  beforeAll(() => {
    ({ db, summary } = seeded());
  });

  it('creates the demo cast and a full load board', () => {
    expect(summary).toEqual({
      users: count(db, 'SELECT COUNT(*) AS n FROM users'),
      drivers: count(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'driver'"),
      shippers: count(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'shipper'"),
      loads: count(db, 'SELECT COUNT(*) AS n FROM loads'),
      openLoads: count(db, "SELECT COUNT(*) AS n FROM loads WHERE status = 'open'"),
      bookings: count(db, 'SELECT COUNT(*) AS n FROM bookings'),
      pendingRequests: count(db, "SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"),
      messages: count(db, 'SELECT COUNT(*) AS n FROM messages'),
      notifications: count(db, 'SELECT COUNT(*) AS n FROM notifications'),
      savedSearches: count(db, 'SELECT COUNT(*) AS n FROM saved_searches'),
    });
    expect(summary.shippers).toBe(5);
    expect(summary.drivers).toBe(12);
    expect(summary.openLoads).toBeGreaterThanOrEqual(150);
    expect(summary.openLoads).toBeLessThanOrEqual(180);
    expect(summary.loads).toBeGreaterThan(summary.openLoads + 20);
    for (const status of ['booked', 'in_transit', 'delivered', 'cancelled']) {
      expect(count(db, 'SELECT COUNT(*) AS n FROM loads WHERE status = ?', status)).toBeGreaterThan(0);
    }
  });

  it('does nothing once the database has users', () => {
    const before = count(db, 'SELECT COUNT(*) AS n FROM loads');
    const again = seedDatabase(db, { now: NOW });
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
    expect(count(db, 'SELECT COUNT(*) AS n FROM loads')).toBe(before);
    expect(count(db, 'SELECT COUNT(*) AS n FROM users')).toBe(summary.users);
  });

  it('produces identical rows for the same clock', () => {
    const other = seeded().db;
    for (const table of ['loads', 'bookings', 'messages', 'notifications', 'saved_searches', 'driver_profiles']) {
      expect(tableRows(other, table)).toEqual(tableRows(db, table));
    }
    // Password salts are random; everything else about a user is fixed.
    const users = 'SELECT id, email, name, role, company, phone, created_at FROM users ORDER BY rowid';
    expect(rows(other, users)).toEqual(rows(db, users));
    // A different clock moves the schedule with it.
    const later = seeded(new Date(NOW.getTime() + 3 * DAY)).db;
    const pickups = 'SELECT pickup_start FROM loads ORDER BY rowid';
    expect(rows(later, pickups)).not.toEqual(rows(db, pickups));
  });

  it('lets every account sign in with the demo password', async () => {
    const hashes = rows(db, 'SELECT DISTINCT password_hash AS h FROM users').map((r) => String(r.h));
    expect(hashes).toHaveLength(1);
    expect(await verifyPassword(DEMO_PASSWORD, hashes[0])).toBe(true);
    expect(await verifyPassword('wrong-password', hashes[0])).toBe(false);
    for (const email of Object.values(DEMO_EMAILS)) expect(userId(db, email)).toBeTruthy();
  });

  it('sets up the demo hotshot, semi and shipper as documented', () => {
    const hotshot = getDriverProfile(db, userId(db, DEMO_EMAILS.hotshot))!;
    expect(hotshot).toMatchObject({
      driverClass: 'hotshot',
      equipmentTypes: ['HS_GOOSENECK'],
      hasCdl: false,
      trailerLengthFt: 40,
      maxPayloadLbs: 10_000,
      maxDeadheadMiles: 150,
      currentLocation: { cityId: 'odessa-tx' },
      homeBase: { cityId: 'midland-tx' },
      available: true,
    });
    const semi = getDriverProfile(db, userId(db, DEMO_EMAILS.semi))!;
    expect(semi).toMatchObject({
      driverClass: 'semi',
      hasCdl: true,
      cdlClass: 'A',
      trailerLengthFt: 48,
      maxPayloadLbs: 47_000,
      currentLocation: { cityId: 'dallas-tx' },
    });
    expect(semi.equipmentTypes).toEqual(expect.arrayContaining(['FLATBED', 'STEP_DECK']));
    expect(semi.endorsements).toContain('hazmat');
    const shipper = db.prepare('SELECT role, company FROM users WHERE email = ?').get(DEMO_EMAILS.shipper);
    expect(shipper).toEqual({ role: 'shipper', company: 'Lone Star Oilfield Supply' });
  });

  it('gives every driver a complete profile that matches their class', () => {
    const drivers = rows(db, "SELECT id FROM users WHERE role = 'driver'").map(
      (r) => getDriverProfile(db, String(r.id))!,
    );
    expect(drivers.filter((p) => !p.profileComplete).map((p) => p.userId)).toEqual([]);
    for (const p of drivers) {
      expect(p.equipmentTypes.every((e) => EQUIPMENT[e].driverClass === p.driverClass)).toBe(true);
      expect(p.homeBase && getCity(p.homeBase.cityId)).toBeTruthy();
      expect(p.hasCdl || p.maxPayloadLbs <= 10_000).toBe(true);
    }
    const fleet = new Set(drivers.flatMap((p) => p.equipmentTypes));
    const expected: EquipmentCode[] = [
      'HS_GOOSENECK', 'HS_DOVETAIL', 'HS_CAR_HAULER', 'DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'RGN', 'TANKER',
      'DRY_BULK',
    ];
    expect(expected.filter((code) => !fleet.has(code))).toEqual([]);
    expect(drivers.some((p) => p.teamDriver)).toBe(true);
  });

  it('only creates loads that pass the freight rules', () => {
    expect(allLoads(db).flatMap((l) => loadProblems(l, NOW.getTime()))).toEqual([]);
    const odd = seeded(ODD_NOW).db;
    expect(allLoads(odd).flatMap((l) => loadProblems(l, ODD_NOW.getTime()))).toEqual([]);
  });

  it('weights hotshot freight to oilfield states and mixes in semi freight', () => {
    const open = allLoads(db).filter((l) => l.status === 'open');
    const hotshot = open.filter((l) => l.equipmentTypes.some(isHotshotCode));
    const oilStates = new Set(['TX', 'OK', 'NM', 'LA', 'ND']);
    expect(hotshot.filter((l) => oilStates.has(l.origin.state)).length / hotshot.length).toBeGreaterThan(0.6);
    const alsoOnDecks = hotshot.filter((l) => l.equipmentTypes.some((e) => OPEN_DECKS.has(e)));
    expect(alsoOnDecks.length).toBeGreaterThan(20);
    const posted: EquipmentCode[] = ['DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'RGN', 'TANKER', 'DRY_BULK', 'HS_CAR_HAULER'];
    expect(posted.filter((code) => !open.some((l) => l.equipmentTypes.includes(code)))).toEqual([]);
    expect(open.some((l) => l.hazmat && l.equipmentTypes.includes('TANKER'))).toBe(true);
    const pickupDays = new Set(open.map((l) => Math.floor((ms(l.pickupStart) - NOW.getTime()) / DAY)));
    expect(pickupDays.size).toBeGreaterThanOrEqual(5);
    expect(new Set(open.map((l) => l.shipperCompany)).size).toBe(5);
  });

  it('posts pneumatic frac sand as dry bulk, which needs no tanker endorsement', () => {
    const open = allLoads(db).filter((l) => l.status === 'open');
    const sand = open.filter((l) => /frac sand/i.test(l.commodity));
    expect(sand.length).toBeGreaterThan(0);
    expect(sand.every((l) => l.equipmentTypes.join() === 'DRY_BULK' && !l.hazmat)).toBe(true);
    const hector = rows(db, "SELECT id FROM users WHERE email = 'hector.salinas@demo.haulmatch.app'").map(
      (r) => getDriverProfile(db, String(r.id))!,
    )[0];
    expect(hector.equipmentTypes).toEqual(expect.arrayContaining(['TANKER', 'DRY_BULK']));
    const noN = { ...hector, endorsements: [] };
    for (const load of sand) {
      const checks = matchLoad(load, noN, { now: NOW, ignoreDeadheadLimit: true }).checks;
      expect(checks.find((c) => c.key === 'tanker')).toBeUndefined();
    }
  });

  for (const [label, email] of [['hotshot', DEMO_EMAILS.hotshot], ['semi', DEMO_EMAILS.semi]] as const) {
    it(`fills the demo ${label} driver's board with loads they can book nearby`, () => {
      const { profile, matches } = boardFor(db, email);
      const eligible = matches.filter((m) => m.match.eligible);
      expect(eligible.length).toBeGreaterThanOrEqual(15);
      const withinDeadhead = (m: { match: MatchResult }) =>
        m.match.deadheadMiles !== null && m.match.deadheadMiles <= profile.maxDeadheadMiles;
      expect(eligible.every(withinDeadhead)).toBe(true);
      expect(eligible.filter((m) => m.match.score >= 70).length).toBeGreaterThanOrEqual(5);
      // Nearby loads that miss on the rig show the driver why they are not bookable.
      expect(matches.filter((m) => !m.match.eligible && withinDeadhead(m)).length).toBeGreaterThan(0);
    });
  }

  it('fills both demo boards under an awkward clock too', () => {
    const odd = seeded(ODD_NOW).db;
    for (const email of [DEMO_EMAILS.hotshot, DEMO_EMAILS.semi]) {
      const eligible = boardFor(odd, email, ODD_NOW).matches.filter((m) => m.match.eligible);
      expect(eligible.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('gives each demo driver booked, in-transit and delivered work with the demo shipper', () => {
    const shipperId = userId(db, DEMO_EMAILS.shipper);
    for (const email of [DEMO_EMAILS.hotshot, DEMO_EMAILS.semi]) {
      const driverId = userId(db, email);
      const profile = getDriverProfile(db, driverId)!;
      const hauls = allLoads(db).filter((l) => l.bookedDriverId === driverId && l.shipperId === shipperId);
      const statuses = hauls.map((l) => l.status);
      expect(statuses.filter((s) => s === 'booked')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'in_transit')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'delivered').length).toBeGreaterThanOrEqual(3);
      for (const load of hauls) {
        // The rig had to fit; timing and deadhead are long past for history.
        const checks = matchLoad({ ...load, status: 'open' }, profile, { ignoreDeadheadLimit: true }).checks;
        const rigChecks = checks.filter((c) => !['status', 'timing', 'deadhead', 'rate'].includes(c.key));
        expect(rigChecks.filter((c) => !c.ok).map((c) => c.label)).toEqual([]);
      }
    }
  });

  it('keeps booking rows consistent with load status', () => {
    const bookings = rows(db, 'SELECT * FROM bookings');
    for (const load of allLoads(db)) {
      const mine = bookings.filter((b) => b.load_id === load.id);
      const accepted = mine.filter((b) => b.status === 'accepted');
      if (load.status === 'open' || load.status === 'cancelled') {
        expect(accepted).toHaveLength(0);
      } else {
        expect(accepted).toHaveLength(1);
        expect(accepted[0].driver_id).toBe(load.bookedDriverId);
        expect(load.bookedRateUsd).toBe((accepted[0].offer_rate_usd as number | null) ?? load.rateUsd);
      }
      if (load.status !== 'open') expect(mine.filter((b) => b.status === 'pending')).toHaveLength(0);
    }
    for (const b of bookings) {
      expect(ms(String(b.updated_at))).toBeGreaterThanOrEqual(ms(String(b.created_at)));
      expect(ms(String(b.created_at))).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('puts 3 to 5 pending requests from other drivers on the demo shipper loads', () => {
    const demoDrivers = [userId(db, DEMO_EMAILS.hotshot), userId(db, DEMO_EMAILS.semi)];
    const pending = rows(
      db,
      `SELECT b.* FROM bookings b JOIN loads l ON l.id = b.load_id
       WHERE b.status = 'pending' AND l.shipper_id = ?`,
      userId(db, DEMO_EMAILS.shipper),
    );
    expect(pending.length).toBeGreaterThanOrEqual(3);
    expect(pending.length).toBeLessThanOrEqual(5);
    expect(pending.some((b) => demoDrivers.includes(String(b.driver_id)))).toBe(false);
    expect(pending.filter((b) => b.offer_rate_usd !== null).length).toBeGreaterThanOrEqual(1);
    for (const b of pending) {
      const load = getLoadById(db, String(b.load_id))!;
      expect(load.status).toBe('open');
      expect(String(b.message).length).toBeGreaterThan(10);
      if (b.offer_rate_usd !== null) expect(Number(b.offer_rate_usd)).toBeGreaterThan(load.rateUsd);
      const profile = getDriverProfile(db, String(b.driver_id))!;
      expect(matchLoad(load, profile, { now: NOW, ignoreDeadheadLimit: true }).eligible).toBe(true);
    }
  });

  it('writes three conversations between the right people', () => {
    const threads = rows(db, 'SELECT load_id, driver_id, COUNT(*) AS n FROM messages GROUP BY load_id, driver_id');
    expect(threads).toHaveLength(3);
    const shipperId = userId(db, DEMO_EMAILS.shipper);
    for (const t of threads) {
      expect(Number(t.n)).toBeGreaterThanOrEqual(3);
      const load = getLoadById(db, String(t.load_id))!;
      expect(load.shipperId).toBe(shipperId);
      const messages = rows(
        db,
        'SELECT * FROM messages WHERE load_id = ? AND driver_id = ? ORDER BY created_at',
        String(t.load_id),
        String(t.driver_id),
      );
      expect(messages.every((m) => m.sender_id === t.driver_id || m.sender_id === load.shipperId)).toBe(true);
      expect(new Set(messages.map((m) => m.sender_id)).size).toBe(2);
      expect(messages.some((m) => m.read_at === null)).toBe(true);
      for (const m of messages) {
        expect(ms(String(m.created_at))).toBeLessThanOrEqual(NOW.getTime());
        if (m.read_at !== null) expect(ms(String(m.read_at))).toBeGreaterThanOrEqual(ms(String(m.created_at)));
      }
    }
    const drivers = new Set(threads.map((t) => t.driver_id));
    expect(drivers.has(userId(db, DEMO_EMAILS.hotshot))).toBe(true);
    expect(drivers.has(userId(db, DEMO_EMAILS.semi))).toBe(true);
  });

  it('sends each demo user a handful of notifications that link somewhere real', () => {
    for (const email of Object.values(DEMO_EMAILS)) {
      const id = userId(db, email);
      const total = count(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', id);
      const unread = count(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', id);
      expect(total).toBeGreaterThanOrEqual(4);
      expect(unread).toBeGreaterThan(0);
    }
    for (const n of rows(db, 'SELECT n.*, u.role FROM notifications n JOIN users u ON u.id = n.user_id')) {
      expect(NOTIFICATION_TYPES.has(String(n.type))).toBe(true);
      expect(ms(String(n.created_at))).toBeLessThanOrEqual(NOW.getTime());
      if (n.read_at !== null) expect(ms(String(n.read_at))).toBeGreaterThanOrEqual(ms(String(n.created_at)));
      const link = String(n.link);
      const driverLink = /^\/driver\/loads\/([\w-]+)$/.exec(link);
      const shipperLink = /^\/shipper\/loads\/([\w-]+)$/.exec(link);
      const threadLink = /^\/messages\/([\w-]+)\/([\w-]+)$/.exec(link);
      if (driverLink) {
        expect(n.role).toBe('driver');
        expect(getLoadById(db, driverLink[1])).not.toBeNull();
      } else if (shipperLink) {
        expect(getLoadById(db, shipperLink[1])?.shipperId).toBe(n.user_id);
      } else if (threadLink) {
        const [, loadId, driverId] = threadLink;
        const sql = 'SELECT COUNT(*) AS n FROM messages WHERE load_id = ? AND driver_id = ?';
        expect(count(db, sql, loadId, driverId)).toBeGreaterThan(0);
        expect([driverId, getLoadById(db, loadId)!.shipperId]).toContain(n.user_id);
      } else {
        expect.fail(`unexpected notification link ${link}`);
      }
    }
  });

  it('alerts the demo drivers only about loads they can haul', () => {
    for (const email of [DEMO_EMAILS.hotshot, DEMO_EMAILS.semi]) {
      const id = userId(db, email);
      const profile = getDriverProfile(db, id)!;
      const alerts = rows(db, "SELECT link FROM notifications WHERE user_id = ? AND type = 'load_match'", id);
      expect(alerts.length).toBeGreaterThanOrEqual(2);
      for (const a of alerts) {
        const load = getLoadById(db, String(a.link).split('/').pop()!)!;
        expect(matchLoad(load, profile, { now: NOW }).eligible).toBe(true);
      }
    }
  });

  it('saves two alerting searches for each demo driver', () => {
    for (const email of [DEMO_EMAILS.hotshot, DEMO_EMAILS.semi]) {
      const searches = rows(db, 'SELECT * FROM saved_searches WHERE user_id = ?', userId(db, email)).map(toSavedSearch);
      expect(searches).toHaveLength(2);
      for (const s of searches) {
        expect(s.alertsEnabled).toBe(true);
        expect(filtersSchema.safeParse(s.filters).success).toBe(true);
      }
    }
    expect(rows(db, 'SELECT user_id FROM saved_searches').every((s) => hasRole(db, s.user_id, 'driver'))).toBe(true);
  });

  it('only references rows that exist', () => {
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
    for (const l of rows(db, 'SELECT shipper_id, booked_driver_id FROM loads')) {
      expect(hasRole(db, l.shipper_id, 'shipper')).toBe(true);
      if (l.booked_driver_id !== null) expect(hasRole(db, l.booked_driver_id, 'driver')).toBe(true);
    }
    const bookings = rows(db, 'SELECT b.driver_id, l.id AS load FROM bookings b LEFT JOIN loads l ON l.id = b.load_id');
    for (const b of bookings) {
      expect(b.load).not.toBeNull();
      expect(hasRole(db, b.driver_id, 'driver')).toBe(true);
    }
    const messages = rows(db, 'SELECT m.driver_id, l.id AS load FROM messages m LEFT JOIN loads l ON l.id = m.load_id');
    for (const m of messages) {
      expect(m.load).not.toBeNull();
      expect(hasRole(db, m.driver_id, 'driver')).toBe(true);
    }
    for (const p of rows(db, 'SELECT current_city_id, home_city_id FROM driver_profiles')) {
      expect(getCity(String(p.current_city_id))).toBeDefined();
      expect(getCity(String(p.home_city_id))).toBeDefined();
    }
  });
});

describe('seed script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haulmatch-seed-'));
  const dbPath = join(dir, 'demo.db');
  const run = (...args: string[]) =>
    execFileSync(resolve('node_modules/.bin/tsx'), ['server/seed.ts', ...args], {
      env: { ...process.env, HAULMATCH_DB: dbPath, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8',
    });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('seeds the file at HAULMATCH_DB, refuses to double-seed, and --reset starts over', () => {
    expect(run('--reset')).toContain('Seeded');
    expect(run()).toContain('nothing seeded');
    const first = openDb(dbPath);
    const users = count(first, 'SELECT COUNT(*) AS n FROM users');
    first.exec("UPDATE users SET name = 'Changed' WHERE role = 'driver'");
    first.close();
    expect(run('--reset')).toContain(DEMO_EMAILS.hotshot);
    const reset = openDb(dbPath);
    expect(count(reset, 'SELECT COUNT(*) AS n FROM users')).toBe(users);
    expect(count(reset, "SELECT COUNT(*) AS n FROM users WHERE name = 'Changed'")).toBe(0);
    reset.close();
  }, 60_000);
});
