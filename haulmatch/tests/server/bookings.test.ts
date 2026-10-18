import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE } from '../../shared/api';
import type { Booking, BookLoadResponse, Load, ServerEvent } from '../../shared/types';
import { createSession } from '../../server/auth';
import { client, createTestApp, insertLoad, seedUser, type TestApp } from '../helpers';

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

const loadRow = (t: TestApp, id: string) =>
  t.db.prepare('SELECT status, booked_driver_id, booked_rate_usd FROM loads WHERE id = ?').get(id) as {
    status: string;
    booked_driver_id: string | null;
    booked_rate_usd: number | null;
  };

const completedLoads = (t: TestApp, driverId: string) =>
  (t.db.prepare('SELECT completed_loads FROM driver_profiles WHERE user_id = ?').get(driverId) as { completed_loads: number })
    .completed_loads;

/** Minimal SSE reader over a real socket: supertest buffers whole responses, which never end for SSE. */
async function openEventStream(app: Express, cookie: string) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { Cookie: cookie } });
  const [res] = (await once(req, 'response')) as [http.IncomingMessage];
  res.setEncoding('utf8');
  const events: ServerEvent[] = [];
  let buffer = '';
  res.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      for (const line of buffer.slice(0, end).split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as ServerEvent);
      }
      buffer = buffer.slice(end + 2);
    }
  });
  const waitFor = async (predicate: (e: ServerEvent) => boolean, timeoutMs = 2_000): Promise<ServerEvent> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for event; got ${JSON.stringify(events)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const close = async () => {
    req.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return { events, waitFor, close };
}

const cookieFor = (t: TestApp, userId: string) => `${SESSION_COOKIE}=${createSession({ db: t.db, now: t.clock.now }, userId)}`;

describe('POST /api/loads/:id/book', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales' });
  });

  it('sends a request on a request-mode load and tells the shipper', async () => {
    const load = insertLoad(t, shipper.user.id);
    const res = await driver.c.post(`/api/loads/${load.id}/book`, { message: '  Empty in Houston now  ' });
    expect(res.status).toBe(201);
    const body = res.body as BookLoadResponse;
    expect(body.booking).toEqual({
      id: expect.any(String),
      loadId: load.id,
      driverId: driver.user.id,
      status: 'pending',
      offerRateUsd: null,
      message: 'Empty in Houston now',
      createdAt: t.clock.now().toISOString(),
      updatedAt: t.clock.now().toISOString(),
    } satisfies Booking);
    expect(body.load).toMatchObject({ id: load.id, status: 'open', bookedDriverId: null, pendingRequestCount: 0 });
    expect(notificationsFor(t, shipper.user.id)).toEqual([
      {
        type: 'booking_request',
        title: 'New request from Jake Morales',
        body: 'Houston, TX → Odessa, TX · at your posted $1,400 · "Empty in Houston now"',
        link: `/shipper/loads/${load.id}`,
      },
    ]);
    expect(notificationsFor(t, driver.user.id)).toEqual([]);
    expect((await shipper.c.get(`/api/loads/${load.id}`)).body.load.pendingRequestCount).toBe(1);
  });

  it('records a counter-offer, and treats offering the posted rate as accepting it', async () => {
    const load = insertLoad(t, shipper.user.id);
    const res = await driver.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 1_650 });
    expect(res.body.booking).toMatchObject({ status: 'pending', offerRateUsd: 1_650 });
    expect(notificationsFor(t, shipper.user.id)[0].body).toBe('Houston, TX → Odessa, TX · offers $1,650 (posted $1,400)');

    const other = seedUser(t, { role: 'driver' });
    const same = await other.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 1_400 });
    expect(same.body.booking.offerRateUsd).toBeNull();
  });

  it('instant-books: the load is covered and waiting requests are turned down', async () => {
    const load = insertLoad(t, shipper.user.id, { bookingMode: 'instant' });
    const waiting = seedUser(t, { role: 'driver' });
    const waitingBooking = insertBooking(t, load.id, waiting.user.id, 'pending', 1_800);

    const res = await driver.c.post(`/api/loads/${load.id}/book`);
    expect(res.status).toBe(201);
    const body = res.body as BookLoadResponse;
    expect(body.booking).toMatchObject({ status: 'accepted', offerRateUsd: null });
    expect(body.load).toMatchObject({ status: 'booked', bookedDriverId: driver.user.id, bookedRateUsd: 1_400 });
    expect(bookingStatus(t, waitingBooking)).toBe('declined');

    expect(notificationsFor(t, shipper.user.id)).toEqual([
      {
        type: 'load_booked',
        title: 'Booked: Houston, TX → Odessa, TX',
        body: 'Jake Morales booked it at $1,400.',
        link: `/shipper/loads/${load.id}`,
      },
    ]);
    expect(notificationsFor(t, waiting.user.id)).toEqual([
      {
        type: 'booking_declined',
        title: 'Load covered: Houston, TX → Odessa, TX',
        body: expect.any(String),
        link: `/driver/loads/${load.id}`,
      },
    ]);
    const detail = (await driver.c.get(`/api/loads/${load.id}`)).body;
    expect(detail.myBooking.status).toBe('accepted');
    expect(detail.bookedDriver.userId).toBe(driver.user.id);
  });

  it('accepts a bare POST with no body at the posted rate', async () => {
    const load = insertLoad(t, shipper.user.id);
    const res = await request(t.app)
      .post(`/api/loads/${load.id}/book`)
      .set('Cookie', cookieFor(t, driver.user.id))
      .set(CSRF_HEADER, CSRF_VALUE);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'pending', offerRateUsd: null, message: '' });
  });

  it('turns a counter-offer on an instant load into a request', async () => {
    const load = insertLoad(t, shipper.user.id, { bookingMode: 'instant' });
    const res = await driver.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 1_700 });
    expect(res.body.booking.status).toBe('pending');
    expect(res.body.load.status).toBe('open');
    expect(notificationsFor(t, shipper.user.id).map((n) => n.type)).toEqual(['booking_request']);
  });

  it('lets exactly one of two drivers racing to instant-book win', async () => {
    const load = insertLoad(t, shipper.user.id, { bookingMode: 'instant' });
    const rival = seedUser(t, { role: 'driver' });
    const [a, b] = await Promise.all([
      driver.c.post(`/api/loads/${load.id}/book`),
      rival.c.post(`/api/loads/${load.id}/book`),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = a.status === 201 ? driver : rival;
    const loser = a.status === 201 ? b : a;
    expect(loser.body.error.code).toBe('conflict');
    expect(loadRow(t, load.id)).toMatchObject({ status: 'booked', booked_driver_id: winner.user.id });
    const live = t.db
      .prepare(`SELECT driver_id FROM bookings WHERE load_id = ? AND status = 'accepted'`)
      .all(load.id) as { driver_id: string }[];
    expect(live).toEqual([{ driver_id: winner.user.id }]);
    expect(notificationsFor(t, shipper.user.id).filter((n) => n.type === 'load_booked')).toHaveLength(1);
  });

  it('allows one live request per driver per load', async () => {
    const load = insertLoad(t, shipper.user.id);
    expect((await driver.c.post(`/api/loads/${load.id}/book`)).status).toBe(201);
    const again = await driver.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 1_500 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_requested');

    // A pending request on an instant load blocks booking it outright too.
    const instant = insertLoad(t, shipper.user.id, { bookingMode: 'instant' });
    await driver.c.post(`/api/loads/${instant.id}/book`, { offerRateUsd: 1_600 });
    expect((await driver.c.post(`/api/loads/${instant.id}/book`)).status).toBe(409);
    expect(loadRow(t, instant.id).status).toBe('open');

    // Once the request is withdrawn the driver may ask again.
    const [pending] = (await driver.c.get('/api/bookings?status=pending')).body as Booking[];
    await driver.c.post(`/api/bookings/${pending.id}/withdraw`);
    expect((await driver.c.post(`/api/loads/${pending.loadId}/book`)).status).toBe(201);
  });

  it.each(['booked', 'in_transit', 'delivered', 'cancelled'] as const)('refuses a load that is %s', async (status) => {
    const other = seedUser(t, { role: 'driver' });
    const load = insertLoad(t, shipper.user.id, { status, bookedDriverId: status === 'cancelled' ? null : other.user.id });
    const res = await driver.c.post(`/api/loads/${load.id}/book`);
    expect(res.status).toBe(409);
  });

  it('needs a complete rig profile', async () => {
    const load = insertLoad(t, shipper.user.id);
    for (const fixture of [{ currentCityId: null }, { equipmentTypes: [] }]) {
      const rookie = seedUser(t, { role: 'driver', driver: fixture });
      const res = await rookie.c.post(`/api/loads/${load.id}/book`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('profile_incomplete');
    }
  });

  it('rejects loads that fail a hard check and says which ones', async () => {
    const heavy = insertLoad(t, shipper.user.id, { weightLbs: 12_000 });
    const res = await driver.c.post(`/api/loads/${heavy.id}/book`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('not_eligible');
    expect(res.body.error.details).toEqual([expect.objectContaining({ key: 'cdl', ok: false, hard: true })]);

    const van = insertLoad(t, shipper.user.id, { equipmentTypes: ['DRY_VAN'], lengthFt: 45, hazmat: true });
    const keys = ((await driver.c.post(`/api/loads/${van.id}/book`)).body.error.details as { key: string }[]).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['equipment', 'length', 'cdl', 'hazmat']));
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM bookings').get()).toEqual({ n: 0 });
  });

  it('rejects a load whose pickup window has closed', async () => {
    const load = insertLoad(t, shipper.user.id);
    t.clock.advance(31);
    const res = await driver.c.post(`/api/loads/${load.id}/book`);
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((c: { key: string }) => c.key)).toContain('status');
  });

  it('does not hold long deadhead against the driver', async () => {
    const load = insertLoad(t, shipper.user.id);
    const dallas = seedUser(t, { role: 'driver', driver: { currentCityId: 'dallas-tx' } });
    expect((await dallas.c.post(`/api/loads/${load.id}/book`)).status).toBe(201);
  });

  it('validates the request and who is asking', async () => {
    const load = insertLoad(t, shipper.user.id);
    expect((await driver.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 10 })).status).toBe(400);
    expect((await driver.c.post(`/api/loads/${load.id}/book`, { offerRateUsd: 1_500.5 })).status).toBe(400);
    expect((await driver.c.post(`/api/loads/${load.id}/book`, { message: 'x'.repeat(501) })).status).toBe(400);
    expect((await shipper.c.post(`/api/loads/${load.id}/book`)).status).toBe(403);
    expect((await client(t.app).post(`/api/loads/${load.id}/book`)).status).toBe(401);
    expect((await driver.c.post(`/api/loads/${randomUUID()}/book`)).status).toBe(404);
  });

  it('pushes live booking and load updates to both sides', async () => {
    const load = insertLoad(t, shipper.user.id, { bookingMode: 'instant' });
    const waiting = seedUser(t, { role: 'driver' });
    const waitingBooking = insertBooking(t, load.id, waiting.user.id);
    const shipperStream = await openEventStream(t.app, cookieFor(t, shipper.user.id));
    const driverStream = await openEventStream(t.app, cookieFor(t, driver.user.id));
    const waitingStream = await openEventStream(t.app, cookieFor(t, waiting.user.id));
    try {
      const booking = ((await driver.c.post(`/api/loads/${load.id}/book`)).body as BookLoadResponse).booking;
      const loadBooked = (e: ServerEvent) => e.type === 'load_updated' && e.loadId === load.id && e.status === 'booked';
      const accepted = (e: ServerEvent) => e.type === 'booking_updated' && e.bookingId === booking.id && e.status === 'accepted';
      await shipperStream.waitFor(loadBooked);
      await shipperStream.waitFor(accepted);
      await shipperStream.waitFor((e) => e.type === 'notification' && e.notification.type === 'load_booked');
      await driverStream.waitFor(loadBooked);
      await driverStream.waitFor(accepted);
      await waitingStream.waitFor(loadBooked);
      await waitingStream.waitFor(
        (e) => e.type === 'booking_updated' && e.bookingId === waitingBooking && e.status === 'declined',
      );
      await shipperStream.waitFor((e) => e.type === 'booking_updated' && e.bookingId === waitingBooking);
    } finally {
      await Promise.all([shipperStream.close(), driverStream.close(), waitingStream.close()]);
    }
  });
});

describe('POST /api/loads/:id/status', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales' });
    load = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    insertBooking(t, load.id, driver.user.id, 'accepted');
  });

  it('moves booked -> in transit -> delivered and keeps the shipper posted', async () => {
    t.clock.advance(20);
    const pickedUp = await driver.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' });
    expect(pickedUp.status).toBe(200);
    expect(pickedUp.body).toMatchObject({ status: 'in_transit', pickedUpAt: t.clock.now().toISOString(), deliveredAt: null });

    t.clock.advance(11);
    const delivered = await driver.c.post(`/api/loads/${load.id}/status`, { status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ status: 'delivered', deliveredAt: t.clock.now().toISOString() });
    expect(delivered.body.pickedUpAt).toBe(pickedUp.body.pickedUpAt);
    expect(completedLoads(t, driver.user.id)).toBe(13);

    expect(notificationsFor(t, shipper.user.id)).toEqual([
      {
        type: 'load_status',
        title: 'Picked up: Houston, TX → Odessa, TX',
        body: 'Jake Morales picked up the load and is rolling.',
        link: `/shipper/loads/${load.id}`,
      },
      {
        type: 'load_status',
        title: 'Delivered: Houston, TX → Odessa, TX',
        body: 'Jake Morales delivered the load.',
        link: `/shipper/loads/${load.id}`,
      },
    ]);
  });

  it('refuses steps out of order', async () => {
    expect((await driver.c.post(`/api/loads/${load.id}/status`, { status: 'delivered' })).status).toBe(409);
    await driver.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' });
    expect((await driver.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' })).status).toBe(409);
    await driver.c.post(`/api/loads/${load.id}/status`, { status: 'delivered' });
    expect((await driver.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' })).status).toBe(409);
    expect((await driver.c.post(`/api/loads/${load.id}/status`, { status: 'delivered' })).status).toBe(409);
    expect(completedLoads(t, driver.user.id)).toBe(13);
    expect((await driver.c.post(`/api/loads/${load.id}/status`, { status: 'cancelled' })).status).toBe(400);
  });

  it('is only for the booked driver', async () => {
    const declined = seedUser(t, { role: 'driver' });
    insertBooking(t, load.id, declined.user.id, 'declined');
    const stranger = seedUser(t, { role: 'driver' });
    expect((await declined.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' })).status).toBe(403);
    expect((await stranger.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' })).status).toBe(404);
    expect((await shipper.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' })).status).toBe(403);
    const open = insertLoad(t, shipper.user.id);
    expect((await driver.c.post(`/api/loads/${open.id}/status`, { status: 'in_transit' })).status).toBe(403);
    expect(loadRow(t, load.id).status).toBe('booked');
  });
});

describe('accepting, declining and withdrawing requests', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let rival: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales' });
    rival = seedUser(t, { role: 'driver', name: 'Rosa Vega' });
    load = insertLoad(t, shipper.user.id);
  });

  it('accepts a counter-offer, books the load at that rate and turns the others down', async () => {
    const mine = insertBooking(t, load.id, driver.user.id, 'pending', 1_550);
    const theirs = insertBooking(t, load.id, rival.user.id, 'pending');
    t.clock.advance(1);
    const res = await shipper.c.post(`/api/bookings/${mine}/accept`);
    expect(res.status).toBe(200);
    const body = res.body as BookLoadResponse;
    expect(body.booking).toMatchObject({ id: mine, status: 'accepted', offerRateUsd: 1_550, updatedAt: t.clock.now().toISOString() });
    expect(body.load).toMatchObject({
      status: 'booked',
      bookedDriverId: driver.user.id,
      bookedRateUsd: 1_550,
      pendingRequestCount: 0,
    });
    expect(bookingStatus(t, theirs)).toBe('declined');
    expect(notificationsFor(t, driver.user.id)).toEqual([
      {
        type: 'booking_accepted',
        title: "You're booked: Houston, TX → Odessa, TX",
        body: 'Lone Star Oilfield Supply accepted your request at $1,550.',
        link: `/driver/loads/${load.id}`,
      },
    ]);
    expect(notificationsFor(t, rival.user.id)).toEqual([
      expect.objectContaining({ type: 'booking_declined', title: 'Load covered: Houston, TX → Odessa, TX', link: `/driver/loads/${load.id}` }),
    ]);
  });

  it('books at the posted rate when there was no counter-offer', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    expect((await shipper.c.post(`/api/bookings/${mine}/accept`)).body.load.bookedRateUsd).toBe(1_400);
  });

  it('refuses to accept a request that is not pending or a load that is covered', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    const theirs = insertBooking(t, load.id, rival.user.id);
    await shipper.c.post(`/api/bookings/${mine}/accept`);
    expect((await shipper.c.post(`/api/bookings/${mine}/accept`)).status).toBe(409);
    expect((await shipper.c.post(`/api/bookings/${theirs}/accept`)).status).toBe(409);

    // A late request that slipped in still cannot take a covered load.
    const late = seedUser(t, { role: 'driver' });
    const lateBooking = insertBooking(t, load.id, late.user.id);
    expect((await shipper.c.post(`/api/bookings/${lateBooking}/accept`)).status).toBe(409);
    expect(loadRow(t, load.id).booked_driver_id).toBe(driver.user.id);
  });

  it('declines a pending request and tells the driver', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    const res = await shipper.c.post(`/api/bookings/${mine}/decline`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: mine, status: 'declined' } satisfies Partial<Booking>);
    expect(notificationsFor(t, driver.user.id)).toEqual([
      {
        type: 'booking_declined',
        title: 'Request declined: Houston, TX → Odessa, TX',
        body: 'Lone Star Oilfield Supply passed on your request this time.',
        link: `/driver/loads/${load.id}`,
      },
    ]);
    expect((await shipper.c.post(`/api/bookings/${mine}/decline`)).status).toBe(409);
    expect(loadRow(t, load.id).status).toBe('open');
  });

  it('only lets the load owner accept or decline', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    const other = seedUser(t, { role: 'shipper' });
    expect((await other.c.post(`/api/bookings/${mine}/accept`)).status).toBe(404);
    expect((await other.c.post(`/api/bookings/${mine}/decline`)).status).toBe(404);
    expect((await driver.c.post(`/api/bookings/${mine}/accept`)).status).toBe(403);
    expect((await driver.c.post(`/api/bookings/${mine}/decline`)).status).toBe(403);
    expect((await shipper.c.post(`/api/bookings/${randomUUID()}/accept`)).status).toBe(404);
    expect(bookingStatus(t, mine)).toBe('pending');
  });

  it('withdraws a pending request and tells the shipper', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    const res = await driver.c.post(`/api/bookings/${mine}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('withdrawn');
    expect(loadRow(t, load.id).status).toBe('open');
    expect(notificationsFor(t, shipper.user.id)).toEqual([
      {
        type: 'booking_withdrawn',
        title: 'Request withdrawn: Houston, TX → Odessa, TX',
        body: 'Jake Morales withdrew their request.',
        link: `/shipper/loads/${load.id}`,
      },
    ]);
    expect((await driver.c.post(`/api/bookings/${mine}/withdraw`)).status).toBe(409);
  });

  it('reopens the load when the booked driver drops it before pickup', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    await shipper.c.post(`/api/bookings/${mine}/accept`);
    const res = await driver.c.post(`/api/bookings/${mine}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('withdrawn');
    expect(loadRow(t, load.id)).toEqual({ status: 'open', booked_driver_id: null, booked_rate_usd: null });
    expect(notificationsFor(t, shipper.user.id)).toEqual([
      expect.objectContaining({
        type: 'booking_withdrawn',
        title: 'Driver dropped: Houston, TX → Odessa, TX',
        body: 'Jake Morales can no longer haul it. The load is open again.',
      }),
    ]);
    // The reopened load can be booked again.
    expect((await rival.c.post(`/api/loads/${load.id}/book`)).status).toBe(201);
  });

  it('refuses to withdraw once the load is picked up or the request is settled', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    await shipper.c.post(`/api/bookings/${mine}/accept`);
    await driver.c.post(`/api/loads/${load.id}/status`, { status: 'in_transit' });
    expect((await driver.c.post(`/api/bookings/${mine}/withdraw`)).status).toBe(409);
    expect(loadRow(t, load.id).status).toBe('in_transit');

    const other = insertLoad(t, shipper.user.id);
    const declined = insertBooking(t, other.id, driver.user.id, 'declined');
    expect((await driver.c.post(`/api/bookings/${declined}/withdraw`)).status).toBe(409);
  });

  it('only lets the booking driver withdraw', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    expect((await rival.c.post(`/api/bookings/${mine}/withdraw`)).status).toBe(404);
    expect((await shipper.c.post(`/api/bookings/${mine}/withdraw`)).status).toBe(403);
    expect(bookingStatus(t, mine)).toBe('pending');
  });

  it('pushes the outcome to the driver who was turned down', async () => {
    const mine = insertBooking(t, load.id, driver.user.id);
    const theirs = insertBooking(t, load.id, rival.user.id);
    const rivalStream = await openEventStream(t.app, cookieFor(t, rival.user.id));
    try {
      await shipper.c.post(`/api/bookings/${mine}/accept`);
      await rivalStream.waitFor((e) => e.type === 'booking_updated' && e.bookingId === theirs && e.status === 'declined');
      await rivalStream.waitFor((e) => e.type === 'load_updated' && e.loadId === load.id && e.status === 'booked');
      await rivalStream.waitFor((e) => e.type === 'notification' && e.notification.type === 'booking_declined');
    } finally {
      await rivalStream.close();
    }
  });
});

describe('listing bookings', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let rival: Seeded;
  let load: Load;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    driver = seedUser(t, { role: 'driver', phone: '432-555-0199' });
    rival = seedUser(t, { role: 'driver', driver: { currentCityId: 'baytown-tx' } });
    load = insertLoad(t, shipper.user.id);
  });

  it("gives drivers their own bookings with the load, newest first", async () => {
    const first = insertBooking(t, load.id, driver.user.id, 'withdrawn');
    t.clock.advance(1);
    const other = insertLoad(t, shipper.user.id, { destinationCityId: 'midland-tx' });
    const second = insertBooking(t, other.id, driver.user.id, 'pending');
    insertBooking(t, load.id, rival.user.id);

    const res = await driver.c.get('/api/bookings');
    expect(res.status).toBe(200);
    const list = res.body as Booking[];
    expect(list.map((b) => b.id)).toEqual([second, first]);
    expect(list[0].load).toMatchObject({ id: other.id, destination: { cityId: 'midland-tx' }, pendingRequestCount: 0 });
    expect(list[0].driver).toBeUndefined();
    expect(((await driver.c.get('/api/bookings?status=withdrawn')).body as Booking[]).map((b) => b.id)).toEqual([first]);
  });

  it('gives shippers bookings on their loads with driver, phone and fit', async () => {
    const theirs = insertBooking(t, load.id, rival.user.id);
    t.clock.advance(1);
    const mine = insertBooking(t, load.id, driver.user.id);
    const otherShipper = seedUser(t, { role: 'shipper' });
    insertBooking(t, insertLoad(t, otherShipper.user.id).id, driver.user.id);

    const list = (await shipper.c.get('/api/bookings')).body as Booking[];
    expect(list.map((b) => b.id)).toEqual([mine, theirs]);
    expect(list[0].driver).toMatchObject({ userId: driver.user.id, phone: '432-555-0199' });
    expect(list[0].load).toMatchObject({ id: load.id, pendingRequestCount: 2 });
    expect(list[0].match).toMatchObject({ eligible: true, deadheadMiles: 0 });
    expect(list[1].match).toMatchObject({ eligible: true, deadheadMiles: 28 });
    expect(((await shipper.c.get('/api/bookings?status=accepted')).body as Booking[])).toEqual([]);
    expect((await shipper.c.get('/api/bookings?status=maybe')).status).toBe(400);
    expect((await client(t.app).get('/api/bookings')).status).toBe(401);
  });

  it('lists the requests on one load for its owner, scored for fit even after it is covered', async () => {
    const theirs = insertBooking(t, load.id, rival.user.id);
    t.clock.advance(1);
    const mine = insertBooking(t, load.id, driver.user.id);
    await shipper.c.post(`/api/bookings/${mine}/accept`);

    const res = await shipper.c.get(`/api/loads/${load.id}/bookings`);
    expect(res.status).toBe(200);
    const list = res.body as Booking[];
    expect(list.map((b) => [b.id, b.status])).toEqual([
      [mine, 'accepted'],
      [theirs, 'declined'],
    ]);
    expect(list[0].driver).toMatchObject({ userId: driver.user.id, phone: '432-555-0199' });
    expect(list[0].match!.eligible).toBe(true);
    expect(list[0].match!.score).toBeGreaterThan(0);
    expect(list[1].driver!.userId).toBe(rival.user.id);

    expect((await seedUser(t, { role: 'shipper' }).c.get(`/api/loads/${load.id}/bookings`)).status).toBe(404);
    expect((await driver.c.get(`/api/loads/${load.id}/bookings`)).status).toBe(403);
  });

  it('refuses another shipper on an open load with 403', async () => {
    insertBooking(t, load.id, driver.user.id);
    expect((await seedUser(t, { role: 'shipper' }).c.get(`/api/loads/${load.id}/bookings`)).status).toBe(403);
  });
});
