import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../shared/api';
import type { AppNotification, Message, ServerEvent, Thread } from '../../shared/types';
import { createSession } from '../../server/auth';
import { client, createTestApp, insertLoad, seedUser, type TestApp } from '../helpers';

type Seeded = ReturnType<typeof seedUser>;

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

function insertBooking(t: TestApp, loadId: string, driverId: string, status = 'pending'): void {
  const now = t.clock.now().toISOString();
  t.db
    .prepare(
      `INSERT INTO bookings (id, load_id, driver_id, status, offer_rate_usd, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '', ?, ?)`,
    )
    .run(randomUUID(), loadId, driverId, status, now, now);
}

const threadsOf = async (who: Seeded) => {
  const res = await who.c.get('/api/threads');
  expect(res.status).toBe(200);
  return res.body as Thread[];
};

const notificationsOf = async (who: Seeded) =>
  ((await who.c.get('/api/notifications')).body.notifications ?? []) as AppNotification[];

describe('messages between a driver and a shipper', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper', name: 'Dana Ortiz', company: 'Lone Star Oilfield Supply' });
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales', company: 'Morales Hotshot' });
  });

  it('lets a driver open a thread on an open load and notifies the shipper', async () => {
    const load = insertLoad(t, shipper.user.id);
    const res = await driver.c.post(`/api/loads/${load.id}/messages`, { body: '  Can you do 6am pickup?  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      loadId: load.id,
      driverId: driver.user.id,
      senderId: driver.user.id,
      senderName: 'Jake Morales',
      body: 'Can you do 6am pickup?',
      createdAt: t.clock.now().toISOString(),
      readAt: null,
    } satisfies Message);

    const [note] = await notificationsOf(shipper);
    expect(note).toMatchObject({
      type: 'message',
      title: 'Message from Jake Morales',
      link: `/messages/${load.id}/${driver.user.id}`,
      readAt: null,
    });
    expect(note.body).toContain('Houston, TX → Odessa, TX');
    expect(note.body).toContain('Can you do 6am pickup?');
    expect(await notificationsOf(driver)).toEqual([]);
  });

  it('builds both sides of the thread list with counterpart, last message and unread count', async () => {
    const load = insertLoad(t, shipper.user.id, { rateUsd: 1_650, commodity: 'Drill collars' });
    const sent = (await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'Still open?' })).body as Message;

    const [driverThread] = await threadsOf(driver);
    expect(driverThread).toEqual({
      loadId: load.id,
      driverId: driver.user.id,
      load: {
        id: load.id,
        origin: load.origin,
        destination: load.destination,
        status: 'open',
        pickupStart: load.pickupStart,
        rateUsd: 1_650,
        commodity: 'Drill collars',
      },
      counterpart: { id: shipper.user.id, name: 'Dana Ortiz', company: 'Lone Star Oilfield Supply', role: 'shipper' },
      lastMessage: sent,
      unreadCount: 0,
    } satisfies Thread);

    const [shipperThread] = await threadsOf(shipper);
    expect(shipperThread).toMatchObject({
      loadId: load.id,
      driverId: driver.user.id,
      counterpart: { id: driver.user.id, name: 'Jake Morales', company: 'Morales Hotshot', role: 'driver' },
      lastMessage: sent,
      unreadCount: 1,
    });
  });

  it('marks only the counterpart messages read when a thread is opened', async () => {
    const load = insertLoad(t, shipper.user.id);
    await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'One' });
    t.clock.advance(0.1);
    await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'Two' });
    t.clock.advance(0.1);

    const opened = await shipper.c.get(`/api/loads/${load.id}/messages?driverId=${driver.user.id}`);
    expect(opened.status).toBe(200);
    const readAt = t.clock.now().toISOString();
    expect(opened.body.map((m: Message) => [m.body, m.readAt])).toEqual([
      ['One', readAt],
      ['Two', readAt],
    ]);
    expect((await threadsOf(shipper))[0].unreadCount).toBe(0);

    t.clock.advance(0.1);
    await shipper.c.post(`/api/loads/${load.id}/messages`, { body: 'Yes, 6am works', driverId: driver.user.id });
    expect((await threadsOf(driver))[0].unreadCount).toBe(1);
    expect((await threadsOf(shipper))[0].unreadCount).toBe(0);

    // Reading as the driver leaves the driver's own messages alone.
    t.clock.advance(0.1);
    const driverView = await driver.c.get(`/api/loads/${load.id}/messages`);
    expect(driverView.body.map((m: Message) => [m.body, m.readAt])).toEqual([
      ['One', readAt],
      ['Two', readAt],
      ['Yes, 6am works', t.clock.now().toISOString()],
    ]);
    expect((await threadsOf(driver))[0].unreadCount).toBe(0);
  });

  it('marks a thread read with POST /messages/read', async () => {
    const load = insertLoad(t, shipper.user.id);
    await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'Ping' });
    await shipper.c.post(`/api/loads/${load.id}/messages`, { body: 'Pong', driverId: driver.user.id });

    const res = await shipper.c.post(`/api/loads/${load.id}/messages/read`, { driverId: driver.user.id });
    expect(res.status).toBe(204);
    expect((await threadsOf(shipper))[0].unreadCount).toBe(0);
    expect((await threadsOf(driver))[0].unreadCount).toBe(1);

    expect((await driver.c.post(`/api/loads/${load.id}/messages/read`)).status).toBe(204);
    expect((await threadsOf(driver))[0].unreadCount).toBe(0);

    expect((await shipper.c.post(`/api/loads/${load.id}/messages/read`)).status).toBe(400);
    const other = seedUser(t, { role: 'driver' });
    expect((await driver.c.post(`/api/loads/${load.id}/messages/read`, { driverId: other.user.id })).status).toBe(403);
    expect((await shipper.c.agent.post(`/api/loads/${load.id}/messages/read`).send({})).status).toBe(403);
    expect((await client(t.app).post(`/api/loads/${load.id}/messages/read`)).status).toBe(401);
  });

  it('sorts threads by last activity and keeps one thread per load and driver', async () => {
    const otherDriver = seedUser(t, { role: 'driver', name: 'Rae Kim' });
    const loadA = insertLoad(t, shipper.user.id);
    const loadB = insertLoad(t, shipper.user.id, { destinationCityId: 'dallas-tx' });

    await driver.c.post(`/api/loads/${loadA.id}/messages`, { body: 'A from Jake' });
    t.clock.advance(1);
    await otherDriver.c.post(`/api/loads/${loadA.id}/messages`, { body: 'A from Rae' });
    t.clock.advance(1);
    await driver.c.post(`/api/loads/${loadB.id}/messages`, { body: 'B from Jake' });

    const key = (th: Thread) => `${th.loadId === loadA.id ? 'A' : 'B'}:${th.driverId === driver.user.id ? 'jake' : 'rae'}`;
    expect((await threadsOf(shipper)).map(key)).toEqual(['B:jake', 'A:rae', 'A:jake']);
    expect((await threadsOf(driver)).map(key)).toEqual(['B:jake', 'A:jake']);
    expect((await threadsOf(otherDriver)).map(key)).toEqual(['A:rae']);

    t.clock.advance(1);
    await shipper.c.post(`/api/loads/${loadA.id}/messages`, { body: 'Reply to Jake', driverId: driver.user.id });
    const shipperThreads = await threadsOf(shipper);
    expect(shipperThreads.map(key)).toEqual(['A:jake', 'B:jake', 'A:rae']);
    expect(shipperThreads[0].lastMessage?.body).toBe('Reply to Jake');
    expect(shipperThreads.map((th) => th.unreadCount)).toEqual([1, 1, 1]);
    expect((await threadsOf(driver)).map(key)).toEqual(['A:jake', 'B:jake']);
  });

  it('breaks ties between threads updated in the same instant by the latest message', async () => {
    const loadA = insertLoad(t, shipper.user.id);
    const loadB = insertLoad(t, shipper.user.id);
    await driver.c.post(`/api/loads/${loadA.id}/messages`, { body: 'first' });
    await driver.c.post(`/api/loads/${loadB.id}/messages`, { body: 'second' });
    expect((await threadsOf(driver)).map((th) => th.loadId)).toEqual([loadB.id, loadA.id]);
    await driver.c.post(`/api/loads/${loadA.id}/messages`, { body: 'third' });
    expect((await threadsOf(driver)).map((th) => th.loadId)).toEqual([loadA.id, loadB.id]);
  });

  it('returns messages oldest first', async () => {
    const load = insertLoad(t, shipper.user.id);
    for (const body of ['one', 'two', 'three']) {
      await driver.c.post(`/api/loads/${load.id}/messages`, { body });
    }
    await shipper.c.post(`/api/loads/${load.id}/messages`, { body: 'four', driverId: driver.user.id });
    const res = await driver.c.get(`/api/loads/${load.id}/messages`);
    expect(res.body.map((m: Message) => m.body)).toEqual(['one', 'two', 'three', 'four']);
    expect(res.body[3]).toMatchObject({ senderId: shipper.user.id, senderName: 'Dana Ortiz', driverId: driver.user.id });
  });

  it('keeps threads private to their participants', async () => {
    const load = insertLoad(t, shipper.user.id);
    await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'Private' });
    const otherShipper = seedUser(t, { role: 'shipper' });
    const otherDriver = seedUser(t, { role: 'driver' });
    insertLoad(t, otherShipper.user.id);

    expect(await threadsOf(otherShipper)).toEqual([]);
    expect(await threadsOf(otherDriver)).toEqual([]);
    // Another driver opening the same load sees only their own (empty) conversation.
    const peek = await otherDriver.c.get(`/api/loads/${load.id}/messages`);
    expect(peek.status).toBe(200);
    expect(peek.body).toEqual([]);
    expect((await otherDriver.c.get(`/api/loads/${load.id}/messages?driverId=${driver.user.id}`)).status).toBe(403);
    // The other shipper cannot read it either.
    expect((await otherShipper.c.get(`/api/loads/${load.id}/messages?driverId=${driver.user.id}`)).status).toBe(403);
  });
});

describe('who may message about a load', () => {
  let t: TestApp;
  let shipper: Seeded;
  let driver: Seeded;
  let other: Seeded;
  beforeEach(() => {
    t = createTestApp();
    shipper = seedUser(t, { role: 'shipper' });
    driver = seedUser(t, { role: 'driver' });
    other = seedUser(t, { role: 'driver' });
  });

  const send = (who: Seeded, loadId: string, extra: Record<string, unknown> = {}) =>
    who.c.post(`/api/loads/${loadId}/messages`, { body: 'Hello there', ...extra });

  it('blocks drivers from loads they cannot see', async () => {
    const coveredByOther = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: other.user.id });
    const res = await send(driver, coveredByOther.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect((await driver.c.get(`/api/loads/${coveredByOther.id}/messages`)).status).toBe(404);
    expect((await send(driver, randomUUID())).status).toBe(404);
  });

  it('lets drivers message about non-open loads they booked or requested', async () => {
    const booked = insertLoad(t, shipper.user.id, { status: 'in_transit', bookedDriverId: driver.user.id });
    expect((await send(driver, booked.id)).status).toBe(201);

    const delivered = insertLoad(t, shipper.user.id, { status: 'delivered', bookedDriverId: driver.user.id });
    expect((await send(driver, delivered.id)).status).toBe(201);

    const requestedThenCovered = insertLoad(t, shipper.user.id, { status: 'booked', bookedDriverId: other.user.id });
    insertBooking(t, requestedThenCovered.id, driver.user.id, 'declined');
    expect((await send(driver, requestedThenCovered.id)).status).toBe(201);

    const cancelled = insertLoad(t, shipper.user.id, { status: 'cancelled' });
    insertBooking(t, cancelled.id, driver.user.id, 'cancelled');
    expect((await send(driver, cancelled.id)).status).toBe(201);
  });

  it('lets a driver keep replying in a thread after the load is covered by someone else', async () => {
    const load = insertLoad(t, shipper.user.id);
    expect((await send(driver, load.id)).status).toBe(201);
    t.db.prepare(`UPDATE loads SET status = 'booked', booked_driver_id = ? WHERE id = ?`).run(other.user.id, load.id);
    expect((await send(shipper, load.id, { driverId: driver.user.id, body: 'Sorry, covered' })).status).toBe(201);
    expect((await send(driver, load.id, { body: 'No problem' })).status).toBe(201);
    expect((await driver.c.get(`/api/loads/${load.id}/messages`)).body).toHaveLength(3);
  });

  it('only lets drivers write in their own thread', async () => {
    const load = insertLoad(t, shipper.user.id);
    const res = await send(driver, load.id, { driverId: other.user.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect((await send(driver, load.id, { driverId: driver.user.id })).status).toBe(201);
  });

  it('requires shippers to own the load', async () => {
    const otherShipper = seedUser(t, { role: 'shipper' });
    const open = insertLoad(t, otherShipper.user.id);
    const openRes = await send(shipper, open.id, { driverId: driver.user.id });
    expect(openRes.status).toBe(403);
    expect(openRes.body.error.code).toBe('forbidden');

    const booked = insertLoad(t, otherShipper.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    expect((await send(shipper, booked.id, { driverId: driver.user.id })).status).toBe(404);
    expect((await shipper.c.get(`/api/loads/${booked.id}/messages?driverId=${driver.user.id}`)).status).toBe(404);
  });

  it('requires shippers to name a driver account', async () => {
    const load = insertLoad(t, shipper.user.id);
    const missing = await send(shipper, load.id);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual([expect.objectContaining({ path: 'driverId' })]);
    expect((await shipper.c.get(`/api/loads/${load.id}/messages`)).status).toBe(400);

    const otherShipper = seedUser(t, { role: 'shipper' });
    const toShipper = await send(shipper, load.id, { driverId: otherShipper.user.id });
    expect(toShipper.status).toBe(404);
    expect((await send(shipper, load.id, { driverId: shipper.user.id })).status).toBe(404);
    expect((await send(shipper, load.id, { driverId: randomUUID() })).status).toBe(404);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it('lets a shipper start a thread with any driver on a load they own, in any status', async () => {
    const open = insertLoad(t, shipper.user.id);
    const res = await send(shipper, open.id, { driverId: driver.user.id, body: 'Want this one?' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ driverId: driver.user.id, senderId: shipper.user.id });
    const [note] = await notificationsOf(driver);
    expect(note).toMatchObject({ type: 'message', link: `/messages/${open.id}/${driver.user.id}` });
    expect(note.title).toContain(shipper.user.company!);

    const delivered = insertLoad(t, shipper.user.id, { status: 'delivered', bookedDriverId: other.user.id });
    expect((await send(shipper, delivered.id, { driverId: other.user.id })).status).toBe(201);
  });

  it('validates the message body', async () => {
    const load = insertLoad(t, shipper.user.id);
    for (const body of ['', '   ', 'x'.repeat(2001)]) {
      const res = await send(driver, load.id, { body });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    expect((await driver.c.post(`/api/loads/${load.id}/messages`, {})).status).toBe(400);
    expect((await send(driver, load.id, { body: 'x'.repeat(2000) })).status).toBe(201);
  });

  it('needs a session and the CSRF header', async () => {
    const load = insertLoad(t, shipper.user.id);
    expect((await client(t.app).get('/api/threads')).status).toBe(401);
    expect((await client(t.app).get(`/api/loads/${load.id}/messages`)).status).toBe(401);
    expect((await client(t.app).post(`/api/loads/${load.id}/messages`, { body: 'hi' })).status).toBe(401);
    const res = await driver.c.agent.post(`/api/loads/${load.id}/messages`).send({ body: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
});

describe('live message events', () => {
  let t: TestApp;
  let streams: Awaited<ReturnType<typeof openEventStream>>[] = [];
  const cookieFor = (userId: string) => `${SESSION_COOKIE}=${createSession({ db: t.db, now: t.clock.now }, userId)}`;
  beforeEach(() => {
    t = createTestApp();
    streams = [];
  });
  afterEach(async () => {
    await Promise.all(streams.map((s) => s.close()));
  });

  const open = async (userId: string) => {
    const stream = await openEventStream(t.app, cookieFor(userId));
    streams.push(stream);
    await stream.waitFor((e) => e.type === 'hello');
    return stream;
  };

  it("pushes the message to both sides, including the sender's other tabs, and notifies only the recipient", async () => {
    const shipper = seedUser(t, { role: 'shipper' });
    const driver = seedUser(t, { role: 'driver' });
    const bystander = seedUser(t, { role: 'driver' });
    const load = insertLoad(t, shipper.user.id);

    const shipperTab = await open(shipper.user.id);
    const driverTab1 = await open(driver.user.id);
    const driverTab2 = await open(driver.user.id);
    const bystanderTab = await open(bystander.user.id);

    const sent = (await driver.c.post(`/api/loads/${load.id}/messages`, { body: 'Loaded and rolling' })).body as Message;

    for (const tab of [shipperTab, driverTab1, driverTab2]) {
      expect(await tab.waitFor((e) => e.type === 'message')).toEqual({ type: 'message', message: sent });
    }
    const note = await shipperTab.waitFor((e) => e.type === 'notification');
    expect(note).toMatchObject({
      type: 'notification',
      notification: { type: 'message', link: `/messages/${load.id}/${driver.user.id}` },
    });

    // Give any stray events time to arrive before asserting their absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(driverTab1.events.some((e) => e.type === 'notification')).toBe(false);
    expect(bystanderTab.events.map((e) => e.type)).toEqual(['hello']);
  });
});
