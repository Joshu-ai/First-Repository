import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCity } from '../../shared/cities';
import { driveHours, roadMiles, transitHours } from '../../shared/geo';
import { compareMatches } from '../../shared/matching';
import type {
  Booking,
  DriverSummary,
  Load,
  LoadDetailResponse,
  LoadListResponse,
  LoadWithMatch,
  RecommendedDriver,
  ShipperStats,
} from '../../shared/types';
import { client, createTestApp, insertLoad, seedUser, type TestApp } from '../helpers';

type Seeded = ReturnType<typeof seedUser>;

const HOUR = 3_600_000;

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

function insertBooking(
  t: TestApp,
  loadId: string,
  driverId: string,
  status: Booking['status'] = 'pending',
  offerRateUsd: number | null = null,
): string {
  const id = randomUUID();
  const now = t.clock.now().toISOString();
  t.db
    .prepare(
      `INSERT INTO bookings (id, load_id, driver_id, status, offer_rate_usd, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
    )
    .run(id, loadId, driverId, status, offerRateUsd, now, now);
  return id;
}

const bookingStatus = (t: TestApp, id: string) =>
  (t.db.prepare('SELECT status FROM bookings WHERE id = ?').get(id) as { status: string }).status;

const at = (t: TestApp, hours: number) => new Date(t.clock.now().getTime() + hours * HOUR).toISOString();

const idsOf = (res: { body: LoadListResponse }) => res.body.loads.map((l) => l.id);

function loadBody(overrides: Record<string, unknown> = {}) {
  return {
    originCityId: 'houston-tx',
    destinationCityId: 'odessa-tx',
    pickupStart: '2026-10-19T08:00:00Z',
    pickupEnd: '2026-10-19T18:00:00Z',
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 9_000,
    lengthFt: 30,
    commodity: 'Drill pipe',
    rateUsd: 1_400,
    ...overrides,
  };
}

describe('POST /api/loads', () => {
  let t: TestApp;
  let shipper: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', name: 'Dana Ortiz', company: 'Lone Star Oilfield Supply' });
  });

  it('creates an open load with lane miles, defaults and normalized dates', async () => {
    const res = await shipper.c.post('/api/loads', loadBody({ referenceNumber: '  PO-7781 ', notes: ' Call ahead ' }));
    expect(res.status).toBe(201);
    const miles = roadMiles(getCity('houston-tx')!, getCity('odessa-tx')!);
    const load = res.body as Load;
    expect(load).toEqual({
      id: expect.any(String),
      shipperId: shipper.user.id,
      shipperName: 'Dana Ortiz',
      shipperCompany: 'Lone Star Oilfield Supply',
      status: 'open',
      origin: { cityId: 'houston-tx', city: 'Houston', state: 'TX', lat: expect.any(Number), lng: expect.any(Number) },
      destination: { cityId: 'odessa-tx', city: 'Odessa', state: 'TX', lat: expect.any(Number), lng: expect.any(Number) },
      pickupStart: '2026-10-19T08:00:00.000Z',
      pickupEnd: '2026-10-19T18:00:00.000Z',
      deliveryBy: null,
      equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
      weightLbs: 9_000,
      lengthFt: 30,
      commodity: 'Drill pipe',
      notes: 'Call ahead',
      loadSize: 'full',
      hazmat: false,
      tarpRequired: false,
      teamRequired: false,
      rateUsd: 1_400,
      miles,
      ratePerMile: Math.round((1_400 / miles) * 100) / 100,
      bookingMode: 'request',
      referenceNumber: 'PO-7781',
      bookedDriverId: null,
      bookedRateUsd: null,
      pendingRequestCount: 0,
      createdAt: t.clock.now().toISOString(),
      updatedAt: t.clock.now().toISOString(),
      pickedUpAt: null,
      deliveredAt: null,
    } satisfies Load);

    const detail = await shipper.c.get(`/api/loads/${load.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.load).toEqual({ ...load, match: null });
  });

  it('stores the optional fields a shipper sets', async () => {
    const res = await shipper.c.post(
      '/api/loads',
      loadBody({
        deliveryBy: '2026-10-20T20:00:00Z',
        loadSize: 'partial',
        hazmat: true,
        tarpRequired: true,
        teamRequired: true,
        bookingMode: 'instant',
        equipmentTypes: ['FLATBED', 'FLATBED', 'STEP_DECK'],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      deliveryBy: '2026-10-20T20:00:00.000Z',
      loadSize: 'partial',
      hazmat: true,
      tarpRequired: true,
      teamRequired: true,
      bookingMode: 'instant',
      equipmentTypes: ['FLATBED', 'STEP_DECK'],
    });
  });

  it.each([
    ['an unknown origin city', { originCityId: 'atlantis-xx' }, 'originCityId'],
    ['an unknown destination city', { destinationCityId: 'nowhere-zz' }, 'destinationCityId'],
    ['an unknown equipment code', { equipmentTypes: ['SPACESHIP'] }, 'equipmentTypes.0'],
    ['no equipment', { equipmentTypes: [] }, 'equipmentTypes'],
    ['the same origin and destination', { destinationCityId: 'houston-tx' }, 'destinationCityId'],
    ['a pickup window that ends before it starts', { pickupEnd: '2026-10-19T07:00:00Z' }, 'pickupEnd'],
    [
      'a pickup window already over',
      { pickupStart: '2026-10-17T08:00:00Z', pickupEnd: '2026-10-18T11:00:00Z' },
      'pickupEnd',
    ],
    ['a delivery deadline before pickup', { deliveryBy: '2026-10-19T07:00:00Z' }, 'deliveryBy'],
    ['an unreadable date', { pickupStart: 'next tuesday' }, 'pickupStart'],
    ['a rate under $50', { rateUsd: 49 }, 'rateUsd'],
    ['a rate over $100,000', { rateUsd: 100_001 }, 'rateUsd'],
    ['a fractional rate', { rateUsd: 1_400.5 }, 'rateUsd'],
    ['zero weight', { weightLbs: 0 }, 'weightLbs'],
    ['too much weight', { weightLbs: 200_001 }, 'weightLbs'],
    ['a length over 100 ft', { lengthFt: 101 }, 'lengthFt'],
    ['a blank commodity', { commodity: '   ' }, 'commodity'],
    ['notes over 2000 characters', { notes: 'x'.repeat(2_001) }, 'notes'],
    ['a long reference number', { referenceNumber: 'x'.repeat(41) }, 'referenceNumber'],
    ['an unknown load size', { loadSize: 'huge' }, 'loadSize'],
    ['an unknown booking mode', { bookingMode: 'auction' }, 'bookingMode'],
  ])('rejects %s', async (_label, overrides, path) => {
    const res = await shipper.c.post('/api/loads', loadBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details[0].path).toBe(path);
  });

  it('rejects missing required fields', async () => {
    const res = await shipper.c.post('/api/loads', { originCityId: 'houston-tx' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('only lets signed-in shippers post', async () => {
    const driver = seedUser(t, { role: 'driver' });
    expect((await driver.c.post('/api/loads', loadBody())).status).toBe(403);
    expect((await client(t.app).post('/api/loads', loadBody())).status).toBe(401);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM loads').get() as { n: number }).n).toBe(0);
  });
});

describe('GET /api/loads for drivers', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let near: Load;
  let heavy: Load;
  let van: Load;
  let hazmat: Load;
  let far: Load;
  let lubbock: Load;
  let sanAntonio: Load;

  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales' });
    // Created a few minutes apart so "newest" has a real order.
    const next = () => t.clock.advance(0.05);
    near = insertLoad(t, shipper.user.id, { commodity: 'Oilfield pipe', rateUsd: 1_400 });
    next();
    heavy = insertLoad(t, shipper.user.id, { destinationCityId: 'dallas-tx', weightLbs: 12_000, commodity: 'Steel coils', rateUsd: 1_500 });
    next();
    van = insertLoad(t, shipper.user.id, { destinationCityId: 'tulsa-ok', equipmentTypes: ['DRY_VAN'], commodity: 'Boxed parts', rateUsd: 2_000 });
    next();
    hazmat = insertLoad(t, shipper.user.id, { originCityId: 'pasadena-tx', destinationCityId: 'san-antonio-tx', hazmat: true, commodity: 'Drilling fluid', rateUsd: 900 });
    next();
    far = insertLoad(t, shipper.user.id, { originCityId: 'dallas-tx', destinationCityId: 'austin-tx', commodity: 'Fence panels', rateUsd: 800 });
    next();
    lubbock = insertLoad(t, shipper.user.id, {
      originCityId: 'baytown-tx',
      destinationCityId: 'lubbock-tx',
      pickupStart: at(t, 40),
      pickupEnd: at(t, 60),
      commodity: 'Frac valves',
      rateUsd: 1_900,
    });
    next();
    sanAntonio = insertLoad(t, shipper.user.id, {
      originCityId: 'sugar-land-tx',
      destinationCityId: 'san-antonio-tx',
      pickupStart: at(t, 2),
      pickupEnd: at(t, 12),
      commodity: 'Pallet racking',
      rateUsd: 700,
    });
    // Never listed: not open, or the pickup window has closed.
    insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    insertLoad(t, shipper.user.id, { status: 'cancelled' });
    insertLoad(t, shipper.user.id, { pickupStart: at(t, -10), pickupEnd: at(t, -1) });
  });

  const eligible = () => [near, lubbock, sanAntonio].map((l) => l.id).sort();
  const everyOpen = () => [near, heavy, van, hazmat, far, lubbock, sanAntonio].map((l) => l.id).sort();

  it('returns only loads the driver can haul, best match first', async () => {
    const res = await driver.c.get('/api/loads');
    expect(res.status).toBe(200);
    const body = res.body as LoadListResponse;
    expect(body.driverProfileComplete).toBe(true);
    expect(body.total).toBe(3);
    expect([...idsOf(res)].sort()).toEqual(eligible());
    expect(body.loads.every((l) => l.match?.eligible)).toBe(true);
    const ranked = [...body.loads].sort((a, b) => compareMatches(a.match, b.match)).map((l) => l.id);
    expect(idsOf(res)).toEqual(ranked);
    expect(body.loads[0].match!.score).toBeGreaterThanOrEqual(body.loads[2].match!.score);
    // The near load is right where the driver is parked.
    expect(body.loads.find((l) => l.id === near.id)!.match!.deadheadMiles).toBe(0);
  });

  it('includes ineligible loads after the eligible ones when asked', async () => {
    const res = await driver.c.get('/api/loads?includeIneligible=true');
    const body = res.body as LoadListResponse;
    expect(body.total).toBe(7);
    expect([...idsOf(res)].sort()).toEqual(everyOpen());
    const flags = body.loads.map((l) => l.match!.eligible);
    expect(flags).toEqual([true, true, true, false, false, false, false]);
    const heavyMatch = body.loads.find((l) => l.id === heavy.id)!.match!;
    expect(heavyMatch.score).toBe(0);
    expect(heavyMatch.checks.find((c) => c.key === 'cdl')).toMatchObject({ ok: false, hard: true });
    // The deadhead limit is a hard check on the board.
    const farMatch = body.loads.find((l) => l.id === far.id)!.match!;
    expect(farMatch.checks.find((c) => c.key === 'deadhead')).toMatchObject({ ok: false, hard: true });
  });

  it('filters by equipment, destination state, weight, hazmat and rate', async () => {
    const get = async (query: string) => [...idsOf(await driver.c.get(`/api/loads?includeIneligible=1&${query}`))].sort();
    expect(await get('equipment=DRY_VAN')).toEqual([van.id]);
    expect(await get('equipment=DRY_VAN,REEFER')).toEqual([van.id]);
    expect(await get('destinationStates=ok')).toEqual([van.id]);
    expect(await get('destinationStates=OK,TX')).toEqual(everyOpen());
    expect(await get('maxWeightLbs=10000')).toEqual(everyOpen().filter((id) => id !== heavy.id));
    expect(await get('hazmat=true')).toEqual([hazmat.id]);
    expect(await get('hazmat=false')).toEqual(everyOpen().filter((id) => id !== hazmat.id));
    const minRate = 3;
    const expected = [near, heavy, van, hazmat, far, lubbock, sanAntonio]
      .filter((l) => l.ratePerMile >= minRate)
      .map((l) => l.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(7);
    expect(await get(`minRatePerMile=${minRate}`)).toEqual(expected);
  });

  it('matches q against commodity and cities, case-insensitively', async () => {
    const get = async (q: string) => [...idsOf(await driver.c.get(`/api/loads?includeIneligible=true&q=${encodeURIComponent(q)}`))].sort();
    expect(await get('FRAC')).toEqual([lubbock.id]);
    expect(await get('tulsa, ok')).toEqual([van.id]);
    expect(await get('san antonio')).toEqual([hazmat.id, sanAntonio.id].sort());
    expect(await get('nothing like this')).toEqual([]);
  });

  it('filters by road miles from an origin city', async () => {
    const get = async (query: string) => [...idsOf(await driver.c.get(`/api/loads?includeIneligible=true&${query}`))].sort();
    // Houston itself, Pasadena (13 mi), Sugar Land (22 mi) and Baytown (28 mi) pickups.
    expect(await get('originCityId=houston-tx&originRadiusMiles=20')).toEqual(
      [near, heavy, van, hazmat].map((l) => l.id).sort(),
    );
    expect(await get('originCityId=houston-tx&originRadiusMiles=30')).toEqual(
      [near, heavy, van, hazmat, lubbock, sanAntonio].map((l) => l.id).sort(),
    );
    expect(await get('originCityId=dallas-tx&originRadiusMiles=10')).toEqual([far.id]);
  });

  it('treats the deadhead limit as soft when searching pickups near another city', async () => {
    // Without an origin search the Dallas load is over the Houston driver's deadhead limit.
    expect(idsOf(await driver.c.get('/api/loads'))).not.toContain(far.id);
    const res = await driver.c.get('/api/loads?originCityId=dallas-tx&originRadiusMiles=10');
    const body = res.body as LoadListResponse;
    expect(idsOf(res)).toEqual([far.id]);
    const match = body.loads[0].match!;
    expect(match.eligible).toBe(true);
    expect(match.checks.find((c) => c.key === 'deadhead')).toMatchObject({ ok: false, hard: false });
  });

  it('filters by pickup window', async () => {
    const get = async (query: string) => [...idsOf(await driver.c.get(`/api/loads?${query}`))].sort();
    expect(await get(`pickupFrom=${at(t, 35)}`)).toEqual([lubbock.id]);
    expect(await get(`pickupTo=${at(t, 5)}`)).toEqual([sanAntonio.id]);
    expect(await get(`pickupFrom=${at(t, 15)}&pickupTo=${at(t, 25)}`)).toEqual([near.id]);
  });

  it('sorts by rate, deadhead, pickup, newest and profit', async () => {
    const list = async (sort: string) =>
      ((await driver.c.get(`/api/loads?includeIneligible=true&sort=${sort}`)).body as LoadListResponse).loads;
    const order = (loads: LoadWithMatch[], cmp: (a: LoadWithMatch, b: LoadWithMatch) => number) =>
      [...loads].sort(cmp).map((l) => l.id);

    const byRate = await list('rate');
    expect(new Set(byRate.map((l) => l.ratePerMile)).size).toBe(7);
    expect(byRate.map((l) => l.id)).toEqual(order(byRate, (a, b) => b.ratePerMile - a.ratePerMile));

    const byDeadhead = await list('deadhead');
    expect(byDeadhead.map((l) => l.id)).toEqual(
      order(byDeadhead, (a, b) => a.match!.deadheadMiles! - b.match!.deadheadMiles!),
    );
    expect(byDeadhead[byDeadhead.length - 1].id).toBe(far.id);

    const byPickup = await list('pickup');
    expect(byPickup[0].id).toBe(sanAntonio.id);
    expect(byPickup[byPickup.length - 1].id).toBe(lubbock.id);

    const byNewest = await list('newest');
    expect(byNewest.map((l) => l.id)).toEqual([sanAntonio, lubbock, far, hazmat, van, heavy, near].map((l) => l.id));

    const byProfit = await list('profit');
    expect(new Set(byProfit.map((l) => l.match!.estimatedProfitUsd)).size).toBe(7);
    expect(byProfit.map((l) => l.id)).toEqual(
      order(byProfit, (a, b) => b.match!.estimatedProfitUsd - a.match!.estimatedProfitUsd),
    );
  });

  it('pages with limit and offset and reports the total before paging', async () => {
    const all = idsOf(await driver.c.get('/api/loads?includeIneligible=true&sort=newest'));
    const page1 = await driver.c.get('/api/loads?includeIneligible=true&sort=newest&limit=3');
    const page3 = await driver.c.get('/api/loads?includeIneligible=true&sort=newest&limit=3&offset=6');
    expect(page1.body.total).toBe(7);
    expect(idsOf(page1)).toEqual(all.slice(0, 3));
    expect(page3.body.total).toBe(7);
    expect(idsOf(page3)).toEqual(all.slice(6));
    expect(idsOf(await driver.c.get('/api/loads?offset=50')).length).toBe(0);
  });

  it.each([
    ['limit=0'],
    ['limit=201'],
    ['offset=-1'],
    ['limit=lots'],
    ['equipment=BOGUS'],
    ['sort=cheapest'],
    ['originCityId=atlantis-xx'],
    ['destinationStates=ZZ'],
  ])('rejects a bad query: %s', async (query) => {
    const res = await driver.c.get(`/api/loads?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('lists every open load without matches until the profile is complete', async () => {
    const rookie = seedUser(t, { role: 'driver', driver: { currentCityId: null } });
    const res = await rookie.c.get('/api/loads');
    const body = res.body as LoadListResponse;
    expect(body.driverProfileComplete).toBe(false);
    expect(body.total).toBe(7);
    expect(body.loads.every((l) => l.match === null)).toBe(true);
    // No match to rank by, so "best" falls back to newest first.
    expect(idsOf(res)).toEqual([sanAntonio, lubbock, far, hazmat, van, heavy, near].map((l) => l.id));
  });

  it('shows shippers every open load, newest first, without matches', async () => {
    const other = seedUser(t, { role: 'shipper' });
    t.clock.advance(0.05);
    const theirs = insertLoad(t, other.user.id);
    insertBooking(t, near.id, driver.user.id);
    insertBooking(t, theirs.id, driver.user.id);

    const res = await shipper.c.get('/api/loads');
    const body = res.body as LoadListResponse;
    expect(body.driverProfileComplete).toBe(false);
    expect(body.total).toBe(8);
    expect(idsOf(res)[0]).toBe(theirs.id);
    expect(body.loads.every((l) => l.match === null)).toBe(true);
    // Pending counts are only revealed on the viewer's own loads.
    expect(body.loads.find((l) => l.id === near.id)!.pendingRequestCount).toBe(1);
    expect(body.loads.find((l) => l.id === theirs.id)!.pendingRequestCount).toBe(0);
    expect((await driver.c.get('/api/loads')).body.loads.every((l: Load) => l.pendingRequestCount === 0)).toBe(true);
  });

  it('requires sign-in', async () => {
    expect((await client(t.app).get('/api/loads')).status).toBe(401);
  });
});

describe('GET /api/loads/:id', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales', phone: '432-555-0199' });
  });

  it('shows an open load to any driver with a match that treats long deadhead as soft', async () => {
    const load = insertLoad(t, shipper.user.id);
    const dallas = seedUser(t, { role: 'driver', driver: { currentCityId: 'dallas-tx' } });
    const res = await dallas.c.get(`/api/loads/${load.id}`);
    expect(res.status).toBe(200);
    const body = res.body as LoadDetailResponse;
    expect(body.load).toMatchObject({ id: load.id, status: 'open', pendingRequestCount: 0 });
    expect(body.load.match!.eligible).toBe(true);
    expect(body.load.match!.deadheadMiles).toBe(263);
    expect(body.load.match!.checks.find((c) => c.key === 'deadhead')).toMatchObject({ ok: false, hard: false });
    expect(body.myBooking).toBeNull();
    expect(body.bookedDriver).toBeNull();
  });

  it('shows open loads to other shippers without a match', async () => {
    const load = insertLoad(t, shipper.user.id);
    insertBooking(t, load.id, driver.user.id);
    const other = seedUser(t, { role: 'shipper' });
    const res = await other.c.get(`/api/loads/${load.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load: { ...load, match: null }, myBooking: null, bookedDriver: null, shipperPhone: null });
    expect((await shipper.c.get(`/api/loads/${load.id}`)).body.load.pendingRequestCount).toBe(1);
  });

  it('gives no match to a driver whose profile is incomplete', async () => {
    const load = insertLoad(t, shipper.user.id);
    const rookie = seedUser(t, { role: 'driver', driver: { equipmentTypes: [] } });
    expect((await rookie.c.get(`/api/loads/${load.id}`)).body.load.match).toBeNull();
  });

  it('hides a covered load from everyone not involved in it', async () => {
    const load = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    const declined = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, declined.user.id, 'declined');
    const stranger = seedUser(t, { role: 'driver' });
    const otherShipper = seedUser(t, { role: 'shipper' });

    expect((await shipper.c.get(`/api/loads/${load.id}`)).status).toBe(200);
    expect((await driver.c.get(`/api/loads/${load.id}`)).status).toBe(200);
    expect((await declined.c.get(`/api/loads/${load.id}`)).status).toBe(200);
    expect((await stranger.c.get(`/api/loads/${load.id}`)).status).toBe(404);
    expect((await otherShipper.c.get(`/api/loads/${load.id}`)).status).toBe(404);
    expect((await driver.c.get(`/api/loads/${randomUUID()}`)).status).toBe(404);
    expect((await client(t.app).get(`/api/loads/${load.id}`)).status).toBe(401);
  });

  it('shows the booked driver only to the shipper and that driver', async () => {
    const load = insertLoad(t, shipper.user.id, { status: 'in_transit', bookedDriverId: driver.user.id });
    insertBooking(t, load.id, driver.user.id, 'accepted');
    const declined = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, declined.user.id, 'declined');

    const owner = (await shipper.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse;
    expect(owner.bookedDriver).toMatchObject({ userId: driver.user.id, name: 'Jake Morales', phone: '432-555-0199' } satisfies Partial<DriverSummary>);
    expect(owner.myBooking).toBeNull();
    const self = (await driver.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse;
    expect(self.bookedDriver?.userId).toBe(driver.user.id);
    expect(self.myBooking?.status).toBe('accepted');
    const other = (await declined.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse;
    expect(other.bookedDriver).toBeNull();
    expect(other.myBooking?.status).toBe('declined');
  });

  it("gives the shipper's phone to the booked driver only", async () => {
    const load = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    insertBooking(t, load.id, driver.user.id, 'accepted');
    const declined = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, declined.user.id, 'declined');
    const open = insertLoad(t, shipper.user.id);

    expect(((await driver.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse).shipperPhone).toBe(shipper.user.phone);
    expect(((await declined.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse).shipperPhone).toBeNull();
    expect(((await shipper.c.get(`/api/loads/${load.id}`)).body as LoadDetailResponse).shipperPhone).toBeNull();
    expect(((await driver.c.get(`/api/loads/${open.id}`)).body as LoadDetailResponse).shipperPhone).toBeNull();
  });

  it("returns the driver's live booking, else the most recent one", async () => {
    const load = insertLoad(t, shipper.user.id);
    const live = insertBooking(t, load.id, driver.user.id, 'pending');
    t.clock.advance(1);
    insertBooking(t, load.id, driver.user.id, 'declined');
    expect((await driver.c.get(`/api/loads/${load.id}`)).body.myBooking.id).toBe(live);

    t.db.prepare(`UPDATE bookings SET status = 'withdrawn' WHERE id = ?`).run(live);
    t.clock.advance(1);
    const latest = insertBooking(t, load.id, driver.user.id, 'withdrawn');
    expect((await driver.c.get(`/api/loads/${load.id}`)).body.myBooking.id).toBe(latest);
  });
});

describe('PATCH /api/loads/:id', () => {
  let t: TestApp;
  let shipper: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    load = insertLoad(t, shipper.user.id);
  });

  it('updates the fields given, recomputes miles and leaves the rest', async () => {
    t.clock.advance(1);
    const res = await shipper.c.patch(`/api/loads/${load.id}`, { destinationCityId: 'midland-tx', rateUsd: 1_500, notes: 'Forklift on site' });
    expect(res.status).toBe(200);
    const miles = roadMiles(getCity('houston-tx')!, getCity('midland-tx')!);
    expect(res.body).toMatchObject({
      destination: { cityId: 'midland-tx', city: 'Midland', state: 'TX' },
      rateUsd: 1_500,
      miles,
      ratePerMile: Math.round((1_500 / miles) * 100) / 100,
      notes: 'Forklift on site',
      commodity: load.commodity,
      pickupStart: load.pickupStart,
      equipmentTypes: load.equipmentTypes,
      createdAt: load.createdAt,
      updatedAt: t.clock.now().toISOString(),
    });
    expect(res.body.miles).not.toBe(load.miles);
  });

  it('can clear the delivery deadline and reference number', async () => {
    await shipper.c.patch(`/api/loads/${load.id}`, { deliveryBy: at(t, 48), referenceNumber: 'BOL-1' });
    const res = await shipper.c.patch(`/api/loads/${load.id}`, { deliveryBy: null, referenceNumber: '' });
    expect(res.body).toMatchObject({ deliveryBy: null, referenceNumber: null });
  });

  it('checks the rules against the merged load', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ destinationCityId: 'houston-tx' }, 'destinationCityId'],
      [{ pickupEnd: at(t, 10) }, 'pickupEnd'],
      [{ pickupStart: at(t, -5), pickupEnd: at(t, -1) }, 'pickupEnd'],
      [{ deliveryBy: at(t, 5) }, 'deliveryBy'],
      [{ originCityId: 'atlantis-xx' }, 'originCityId'],
      [{ equipmentTypes: [] }, 'equipmentTypes'],
    ];
    for (const [body, path] of cases) {
      const res = await shipper.c.patch(`/api/loads/${load.id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.details[0].path).toBe(path);
    }
    expect((await shipper.c.get(`/api/loads/${load.id}`)).body.load.updatedAt).toBe(load.updatedAt);
  });

  it('lets the shipper fix details on a load whose window lapsed without moving the window', async () => {
    t.clock.advance(31);
    expect((await shipper.c.patch(`/api/loads/${load.id}`, { notes: 'Gate code 4411' })).status).toBe(200);
  });

  it('tells drivers with pending requests that the load changed', async () => {
    const pending = seedUser(t, { role: 'driver' });
    const declined = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, pending.user.id, 'pending');
    insertBooking(t, load.id, declined.user.id, 'declined');
    await shipper.c.patch(`/api/loads/${load.id}`, { rateUsd: 1_550 });
    expect(notificationsFor(t, pending.user.id)).toEqual([
      {
        type: 'load_status',
        title: 'Load updated: Houston, TX → Odessa, TX',
        body: expect.stringContaining('Lone Star Oilfield Supply changed the details'),
        link: `/driver/loads/${load.id}`,
      },
    ]);
    expect(notificationsFor(t, declined.user.id)).toEqual([]);
    expect(notificationsFor(t, shipper.user.id)).toEqual([]);
  });

  it('keeps each waiting request at the rate it was made at when the shipper changes the rate', async () => {
    const atPosted = seedUser(t, { role: 'driver', name: 'Jake Morales' });
    const countered = seedUser(t, { role: 'driver' });
    const postedId = insertBooking(t, load.id, atPosted.user.id);
    const counterId = insertBooking(t, load.id, countered.user.id, 'pending', 1_500);
    const offerOf = (id: string) =>
      (t.db.prepare('SELECT offer_rate_usd FROM bookings WHERE id = ?').get(id) as { offer_rate_usd: number | null }).offer_rate_usd;

    expect((await shipper.c.patch(`/api/loads/${load.id}`, { rateUsd: 500 })).status).toBe(200);
    expect(offerOf(postedId)).toBe(1_400);
    expect(offerOf(counterId)).toBe(1_500);
    expect(bookingStatus(t, postedId)).toBe('pending');
    expect(notificationsFor(t, atPosted.user.id)).toEqual([
      {
        type: 'load_status',
        title: 'Load updated: Houston, TX → Odessa, TX',
        body: 'Lone Star Oilfield Supply changed the details: the rate is now $500 (was $1,400). Your request stands at $1,400.',
        link: `/driver/loads/${load.id}`,
      },
    ]);

    // Accepting books the driver at what they asked for, never at the cut rate.
    const accepted = await shipper.c.post(`/api/bookings/${postedId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.load).toMatchObject({ status: 'booked', rateUsd: 500, bookedRateUsd: 1_400 });
    expect(notificationsFor(t, atPosted.user.id).at(-1)!.body).toBe('Lone Star Oilfield Supply accepted your request at $1,400.');
  });

  it('reads a request that matches the new rate as taking it, and says how to take a raise', async () => {
    const atPosted = seedUser(t, { role: 'driver' });
    const countered = seedUser(t, { role: 'driver' });
    const postedId = insertBooking(t, load.id, atPosted.user.id);
    const counterId = insertBooking(t, load.id, countered.user.id, 'pending', 1_500);
    await shipper.c.patch(`/api/loads/${load.id}`, { rateUsd: 1_500 });

    const bookings = (await shipper.c.get(`/api/loads/${load.id}/bookings`)).body as Booking[];
    expect(Object.fromEntries(bookings.map((b) => [b.id, b.offerRateUsd]))).toEqual({ [postedId]: 1_400, [counterId]: null });
    expect(notificationsFor(t, atPosted.user.id)[0].body).toBe(
      'Lone Star Oilfield Supply changed the details: the rate is now $1,500 (was $1,400). Your request stands at $1,400. ' +
        'Withdraw it and send a new one to take the new rate.',
    );
    expect(notificationsFor(t, countered.user.id)[0].body).toContain('Your request stands at $1,500.');
  });

  it('cancels waiting requests when the lane, pickup window or delivery deadline changes', async () => {
    const pending = seedUser(t, { role: 'driver' });
    const declined = seedUser(t, { role: 'driver' });
    const pendingId = insertBooking(t, load.id, pending.user.id);
    const declinedId = insertBooking(t, load.id, declined.user.id, 'declined');

    // Sending the same window again changes nothing that matters.
    await shipper.c.patch(`/api/loads/${load.id}`, { pickupStart: load.pickupStart, pickupEnd: load.pickupEnd });
    expect(bookingStatus(t, pendingId)).toBe('pending');

    const res = await shipper.c.patch(`/api/loads/${load.id}`, { pickupStart: at(t, 30), pickupEnd: at(t, 40) });
    expect(res.status).toBe(200);
    expect(res.body.pendingRequestCount).toBe(0);
    expect(bookingStatus(t, pendingId)).toBe('cancelled');
    expect(bookingStatus(t, declinedId)).toBe('declined');
    expect(notificationsFor(t, pending.user.id).at(-1)).toEqual({
      type: 'load_status',
      title: 'Request cancelled: Houston, TX → Odessa, TX',
      body: 'Lone Star Oilfield Supply changed the pickup window, so your request was cancelled. Send a new one if the new terms work for you.',
      link: `/driver/loads/${load.id}`,
    });
    expect(notificationsFor(t, declined.user.id)).toEqual([]);

    // The driver can ask again on the new terms.
    expect((await pending.c.post(`/api/loads/${load.id}/book`)).status).toBe(201);
    await shipper.c.patch(`/api/loads/${load.id}`, { destinationCityId: 'midland-tx', deliveryBy: at(t, 60) });
    expect(notificationsFor(t, pending.user.id).at(-1)).toMatchObject({
      title: 'Request cancelled: Houston, TX → Midland, TX',
      body: expect.stringContaining('changed the lane and delivery deadline, so your request was cancelled'),
    });
    // Newest first: the second request, the declined one, then the first request.
    expect((await shipper.c.get(`/api/loads/${load.id}/bookings`)).body.map((b: Booking) => b.status)).toEqual([
      'cancelled',
      'declined',
      'cancelled',
    ]);
  });

  it('treats an empty edit as a no-op', async () => {
    const pending = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, pending.user.id, 'pending');
    t.clock.advance(1);
    const res = await shipper.c.patch(`/api/loads/${load.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(load.updatedAt);
    expect(notificationsFor(t, pending.user.id)).toEqual([]);
  });

  it('only lets the owner edit, and only while open', async () => {
    const driver = seedUser(t, { role: 'driver' });
    const other = seedUser(t, { role: 'shipper' });
    expect((await driver.c.patch(`/api/loads/${load.id}`, { rateUsd: 1 })).status).toBe(403);
    expect((await other.c.patch(`/api/loads/${load.id}`, { rateUsd: 1_500 })).status).toBe(403);

    const booked = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    const res = await shipper.c.patch(`/api/loads/${booked.id}`, { rateUsd: 1_500 });
    expect(res.status).toBe(409);
    expect((await other.c.patch(`/api/loads/${booked.id}`, { rateUsd: 1_500 })).status).toBe(404);
    expect((await shipper.c.patch(`/api/loads/${randomUUID()}`, { rateUsd: 1_500 })).status).toBe(404);
  });
});

describe('POST /api/loads/:id/cancel', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver' });
  });

  it('cancels an open load and its pending requests, telling those drivers', async () => {
    const load = insertLoad(t, shipper.user.id);
    const declinedDriver = seedUser(t, { role: 'driver' });
    const pending = insertBooking(t, load.id, driver.user.id, 'pending');
    const declined = insertBooking(t, load.id, declinedDriver.user.id, 'declined');

    const res = await shipper.c.post(`/api/loads/${load.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: load.id, status: 'cancelled', pendingRequestCount: 0 });
    expect(bookingStatus(t, pending)).toBe('cancelled');
    expect(bookingStatus(t, declined)).toBe('declined');
    expect(notificationsFor(t, driver.user.id)).toEqual([
      {
        type: 'load_cancelled',
        title: 'Cancelled: Houston, TX → Odessa, TX',
        body: 'Lone Star Oilfield Supply cancelled this load.',
        link: `/driver/loads/${load.id}`,
      },
    ]);
    expect(notificationsFor(t, declinedDriver.user.id)).toEqual([]);
    // The driver who had a request can still open it; strangers cannot.
    expect((await driver.c.get(`/api/loads/${load.id}`)).status).toBe(200);
    expect((await seedUser(t, { role: 'driver' }).c.get(`/api/loads/${load.id}`)).status).toBe(404);
  });

  it('cancels a booked load and releases the booked driver', async () => {
    const load = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    const accepted = insertBooking(t, load.id, driver.user.id, 'accepted');
    const res = await shipper.c.post(`/api/loads/${load.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', bookedDriverId: null, bookedRateUsd: null });
    expect(bookingStatus(t, accepted)).toBe('cancelled');
    expect(notificationsFor(t, driver.user.id).map((n) => n.type)).toEqual(['load_cancelled']);
  });

  it.each(['in_transit', 'delivered', 'cancelled'] as const)('refuses to cancel a load that is %s', async (status) => {
    const load = insertLoad(t, shipper.user.id, { status, bookedDriverId: status === 'cancelled' ? null : driver.user.id });
    const res = await shipper.c.post(`/api/loads/${load.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('only lets the owner cancel', async () => {
    const load = insertLoad(t, shipper.user.id);
    expect((await seedUser(t, { role: 'shipper' }).c.post(`/api/loads/${load.id}/cancel`)).status).toBe(403);
    expect((await driver.c.post(`/api/loads/${load.id}/cancel`)).status).toBe(403);
    expect((await shipper.c.post(`/api/loads/${randomUUID()}/cancel`)).status).toBe(404);
    expect((await shipper.c.get(`/api/loads/${load.id}`)).body.load.status).toBe('open');
  });
});

describe('GET /api/loads/:id/backhauls', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let headhaul: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    // A tight deadhead limit proves backhauls ignore it.
    driver = seedUser(t, { role: 'driver', driver: { maxDeadheadMiles: 50 } });
    // Houston -> Odessa, pickup closes at +30h; about 10h of driving puts the truck empty in Odessa at ~+40h.
    headhaul = insertLoad(t, shipper.user.id);
  });

  const later = () => ({ pickupStart: at(t, 42), pickupEnd: at(t, 72) });

  it('finds eligible loads near the drop, matched from there, best first', async () => {
    const midland = insertLoad(t, shipper.user.id, { originCityId: 'midland-tx', destinationCityId: 'dallas-tx', rateUsd: 1_300, ...later() });
    const odessa = insertLoad(t, shipper.user.id, { originCityId: 'odessa-tx', destinationCityId: 'el-paso-tx', rateUsd: 900, ...later() });
    const lubbock = insertLoad(t, shipper.user.id, { originCityId: 'lubbock-tx', destinationCityId: 'amarillo-tx', rateUsd: 600, ...later() });
    // Too far from Odessa, too heavy, gone before the truck arrives, or not open.
    insertLoad(t, shipper.user.id, { originCityId: 'abilene-tx', destinationCityId: 'dallas-tx', ...later() });
    insertLoad(t, shipper.user.id, { originCityId: 'midland-tx', destinationCityId: 'dallas-tx', weightLbs: 14_000, ...later() });
    insertLoad(t, shipper.user.id, { originCityId: 'midland-tx', destinationCityId: 'dallas-tx', pickupStart: at(t, 30), pickupEnd: at(t, 35) });
    insertLoad(t, shipper.user.id, { originCityId: 'midland-tx', destinationCityId: 'dallas-tx', status: 'booked', ...later() });

    const res = await driver.c.get(`/api/loads/${headhaul.id}/backhauls`);
    expect(res.status).toBe(200);
    const loads = res.body as LoadWithMatch[];
    expect(loads.map((l) => l.id).sort()).toEqual([midland.id, odessa.id, lubbock.id].sort());
    expect(loads.map((l) => l.id)).toEqual([...loads].sort((a, b) => compareMatches(a.match, b.match)).map((l) => l.id));
    expect(loads.find((l) => l.id === odessa.id)!.match!.deadheadMiles).toBe(0);
    expect(loads.find((l) => l.id === lubbock.id)!.match).toMatchObject({ eligible: true, deadheadMiles: 144 });
    expect(loads.every((l) => l.id !== headhaul.id)).toBe(true);
  });

  it('waits for the delivery deadline when the load has one', async () => {
    const withDeadline = insertLoad(t, shipper.user.id, { deliveryBy: at(t, 80) });
    const early = insertLoad(t, shipper.user.id, { originCityId: 'odessa-tx', destinationCityId: 'el-paso-tx', ...later() });
    const afterDrop = insertLoad(t, shipper.user.id, {
      originCityId: 'odessa-tx',
      destinationCityId: 'el-paso-tx',
      pickupStart: at(t, 80),
      pickupEnd: at(t, 96),
    });
    const ids = ((await driver.c.get(`/api/loads/${withDeadline.id}/backhauls`)).body as LoadWithMatch[]).map((l) => l.id);
    expect(ids).toContain(afterDrop.id);
    expect(ids).not.toContain(early.id);
  });

  it('counts the hours-of-service break on a long run with no delivery deadline', async () => {
    // Regression: the drop was timed as non-stop driving. Houston -> El Paso is about 16 h behind
    // the wheel, so the truck is legally empty about 26 h after pickup closes (+30h), not 16 h.
    const longRun = insertLoad(t, shipper.user.id, { destinationCityId: 'el-paso-tx' });
    expect(driveHours(longRun.miles)).toBeGreaterThan(11);
    const nonStop = 30 + driveHours(longRun.miles);
    const legal = 30 + transitHours(longRun.miles);
    expect(legal - nonStop).toBe(10);
    const elPaso = { originCityId: 'el-paso-tx', destinationCityId: 'odessa-tx' };
    const beforeBreakEnds = insertLoad(t, shipper.user.id, { ...elPaso, pickupStart: at(t, nonStop - 2), pickupEnd: at(t, nonStop + 4) });
    const afterBreak = insertLoad(t, shipper.user.id, { ...elPaso, pickupStart: at(t, legal), pickupEnd: at(t, legal + 8) });
    const ids = ((await driver.c.get(`/api/loads/${longRun.id}/backhauls`)).body as LoadWithMatch[]).map((l) => l.id);
    expect(ids).toContain(afterBreak.id);
    expect(ids).not.toContain(beforeBreakEnds.id);
  });

  it('returns at most 10', async () => {
    for (let i = 0; i < 12; i++) {
      insertLoad(t, shipper.user.id, { originCityId: 'midland-tx', destinationCityId: 'dallas-tx', rateUsd: 1_000 + i * 10, ...later() });
    }
    expect(((await driver.c.get(`/api/loads/${headhaul.id}/backhauls`)).body as LoadWithMatch[]).length).toBe(10);
  });

  it('is for drivers who can see the load', async () => {
    expect((await shipper.c.get(`/api/loads/${headhaul.id}/backhauls`)).status).toBe(403);
    const covered = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: seedUser(t, { role: 'driver' }).user.id });
    expect((await driver.c.get(`/api/loads/${covered.id}/backhauls`)).status).toBe(404);
    expect((await driver.c.get(`/api/loads/${randomUUID()}/backhauls`)).status).toBe(404);
  });
});

describe('GET /api/loads/:id/recommended-drivers', () => {
  let t: TestApp;
  let shipper: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    load = insertLoad(t, shipper.user.id);
  });

  it('ranks available, eligible drivers and leaves out the rest', async () => {
    const near = seedUser(t, { role: 'driver', name: 'Near Hotshot' });
    const dallas = seedUser(t, { role: 'driver', name: 'Dallas Hotshot', driver: { currentCityId: 'dallas-tx' } });
    const semi = seedUser(t, { role: 'driver', name: 'Flatbed Semi', driver: { driverClass: 'semi', currentCityId: 'baytown-tx' } });
    const knownDriver = seedUser(t, { role: 'driver', name: 'Declined Before', phone: '713-555-0142' });
    insertBooking(t, load.id, knownDriver.user.id, 'declined');
    // Left out: off duty, no location yet, wrong trailer, and already asked for this load.
    seedUser(t, { role: 'driver', driver: { available: false } });
    seedUser(t, { role: 'driver', driver: { currentCityId: null } });
    seedUser(t, { role: 'driver', driver: { driverClass: 'semi', equipmentTypes: ['DRY_VAN'] } });
    const requester = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, requester.user.id, 'pending');

    const res = await shipper.c.get(`/api/loads/${load.id}/recommended-drivers`);
    expect(res.status).toBe(200);
    const recs = res.body as RecommendedDriver[];
    expect(recs.map((r) => r.driver.userId).sort()).toEqual(
      [near, dallas, semi, knownDriver].map((d) => d.user.id).sort(),
    );
    expect(recs.every((r) => r.match.eligible)).toBe(true);
    expect(recs.map((r) => r.driver.userId)).toEqual(
      [...recs].sort((a, b) => compareMatches(a.match, b.match)).map((r) => r.driver.userId),
    );
    // Dallas is past that driver's deadhead limit, which is only soft here.
    expect(recs.find((r) => r.driver.userId === dallas.user.id)!.match.deadheadMiles).toBe(263);
    // Phones only for drivers who already dealt with this shipper.
    expect(recs.find((r) => r.driver.userId === knownDriver.user.id)!.driver.phone).toBe('713-555-0142');
    expect(recs.find((r) => r.driver.userId === near.user.id)!.driver).toMatchObject({ name: 'Near Hotshot', phone: null });
  });

  it('returns at most 20 and nothing for a load that is no longer open', async () => {
    for (let i = 0; i < 22; i++) seedUser(t, { role: 'driver' });
    expect(((await shipper.c.get(`/api/loads/${load.id}/recommended-drivers`)).body as RecommendedDriver[]).length).toBe(20);
    t.db.prepare(`UPDATE loads SET status = 'cancelled' WHERE id = ?`).run(load.id);
    expect((await shipper.c.get(`/api/loads/${load.id}/recommended-drivers`)).body).toEqual([]);
  });

  it('is only for the owner', async () => {
    expect((await seedUser(t, { role: 'shipper' }).c.get(`/api/loads/${load.id}/recommended-drivers`)).status).toBe(403);
    expect((await seedUser(t, { role: 'driver' }).c.get(`/api/loads/${load.id}/recommended-drivers`)).status).toBe(403);
  });
});

describe('POST /api/loads/:id/invite', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver' });
    load = insertLoad(t, shipper.user.id);
  });

  it('notifies the driver with a link to the load', async () => {
    const res = await shipper.c.post(`/api/loads/${load.id}/invite`, { driverId: driver.user.id, message: ' Got a pipe load for you ' });
    expect(res.status).toBe(204);
    expect(notificationsFor(t, driver.user.id)).toEqual([
      {
        type: 'load_match',
        title: 'Invited: Houston, TX → Odessa, TX · $1,400',
        body: 'Got a pipe load for you',
        link: `/driver/loads/${load.id}`,
      },
    ]);
    await shipper.c.post(`/api/loads/${load.id}/invite`, { driverId: driver.user.id });
    expect(notificationsFor(t, driver.user.id)[1].body).toBe('Lone Star Oilfield Supply thinks this load fits your rig.');
  });

  it('checks the load, the driver and who is asking', async () => {
    const otherShipper = seedUser(t, { role: 'shipper' });
    expect((await shipper.c.post(`/api/loads/${load.id}/invite`, {})).status).toBe(400);
    expect((await shipper.c.post(`/api/loads/${load.id}/invite`, { driverId: randomUUID() })).status).toBe(404);
    expect((await shipper.c.post(`/api/loads/${load.id}/invite`, { driverId: otherShipper.user.id })).status).toBe(404);
    expect((await otherShipper.c.post(`/api/loads/${load.id}/invite`, { driverId: driver.user.id })).status).toBe(403);
    expect((await driver.c.post(`/api/loads/${load.id}/invite`, { driverId: driver.user.id })).status).toBe(403);
    const booked = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    expect((await shipper.c.post(`/api/loads/${booked.id}/invite`, { driverId: driver.user.id })).status).toBe(409);
    expect(notificationsFor(t, driver.user.id)).toEqual([]);
  });

  it('refuses to offer an open load whose pickup window has passed', async () => {
    t.clock.advance(31);
    const res = await shipper.c.post(`/api/loads/${load.id}/invite`, { driverId: driver.user.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/pickup window has passed/i);
    expect(notificationsFor(t, driver.user.id)).toEqual([]);
  });
});

describe('shipper views', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let loads: Record<string, Load>;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    driver = seedUser(t, { role: 'driver' });
    loads = {};
    const statuses = ['open', 'open', 'booked', 'in_transit', 'delivered', 'cancelled'] as const;
    statuses.forEach((status, i) => {
      t.clock.advance(0.05);
      const bookedDriverId = status === 'open' || status === 'cancelled' ? null : driver.user.id;
      loads[`${status}${i}`] = insertLoad(t, shipper.user.id, { status, bookedDriverId });
    });
    insertBooking(t, loads.open0.id, driver.user.id, 'pending');
    insertBooking(t, loads.open1.id, driver.user.id, 'pending');
    insertBooking(t, loads.open1.id, seedUser(t, { role: 'driver' }).user.id, 'pending');
    insertBooking(t, loads.open1.id, seedUser(t, { role: 'driver' }).user.id, 'declined');
    // Someone else's load never shows up.
    const other = seedUser(t, { role: 'shipper' });
    insertBooking(t, insertLoad(t, other.user.id).id, driver.user.id, 'pending');
  });

  it('lists my loads newest first with pending request counts', async () => {
    const res = await shipper.c.get('/api/shipper/loads');
    expect(res.status).toBe(200);
    const list = res.body as Load[];
    expect(list.map((l) => l.id)).toEqual(
      ['cancelled5', 'delivered4', 'in_transit3', 'booked2', 'open1', 'open0'].map((k) => loads[k].id),
    );
    expect(list.find((l) => l.id === loads.open1.id)!.pendingRequestCount).toBe(2);
    expect(list.find((l) => l.id === loads.open0.id)!.pendingRequestCount).toBe(1);
  });

  it('filters by status, with active meaning open, booked or in transit', async () => {
    const ids = async (status: string) => ((await shipper.c.get(`/api/shipper/loads?status=${status}`)).body as Load[]).map((l) => l.id);
    expect(await ids('open')).toEqual([loads.open1.id, loads.open0.id]);
    expect(await ids('delivered')).toEqual([loads.delivered4.id]);
    expect(await ids('active')).toEqual(['in_transit3', 'booked2', 'open1', 'open0'].map((k) => loads[k].id));
    expect((await shipper.c.get('/api/shipper/loads?status=lost')).status).toBe(400);
  });

  it('counts loads by status and pending requests', async () => {
    const res = await shipper.c.get('/api/shipper/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      open: 2,
      expired: 0,
      booked: 1,
      inTransit: 1,
      delivered: 1,
      cancelled: 1,
      pendingRequests: 3,
    } satisfies ShipperStats);
    const fresh = seedUser(t, { role: 'shipper' });
    expect((await fresh.c.get('/api/shipper/stats')).body).toEqual({
      open: 0,
      expired: 0,
      booked: 0,
      inTransit: 0,
      delivered: 0,
      cancelled: 0,
      pendingRequests: 0,
    });
  });

  it('counts open loads whose pickup window has passed as expired, not open, and still lists them', async () => {
    const stale = insertLoad(t, shipper.user.id, { pickupStart: at(t, -30), pickupEnd: at(t, -2) });
    const stats = (await shipper.c.get('/api/shipper/stats')).body as ShipperStats;
    expect(stats).toMatchObject({ open: 2, expired: 1 });
    // The shipper still needs it in the list to move the window or cancel it.
    const active = (await shipper.c.get('/api/shipper/loads?status=active')).body as Load[];
    expect(active.map((l) => l.id)).toContain(stale.id);

    t.clock.advance(31);
    expect((await shipper.c.get('/api/shipper/stats')).body).toMatchObject({ open: 0, expired: 3 });
  });

  it('is only for shippers', async () => {
    expect((await driver.c.get('/api/shipper/loads')).status).toBe(403);
    expect((await driver.c.get('/api/shipper/stats')).status).toBe(403);
    expect((await client(t.app).get('/api/shipper/stats')).status).toBe(401);
  });
});
