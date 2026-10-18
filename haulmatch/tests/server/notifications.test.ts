import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../shared/api';
import type { AppNotification, SavedSearch, ServerEvent } from '../../shared/types';
import { createSession } from '../../server/auth';
import { connectedClientCount, notify } from '../../server/events';
import { MAX_SAVED_SEARCHES } from '../../server/routes/savedSearches';
import { client, createTestApp, seedUser, type TestApp } from '../helpers';

/** Minimal SSE reader over a real socket: supertest buffers whole responses, which never end for SSE. */
async function openEventStream(app: Express, cookie?: string) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: cookie ? { Cookie: cookie } : {} });
  const [res] = (await once(req, 'response')) as [http.IncomingMessage];
  res.setEncoding('utf8');

  const events: ServerEvent[] = [];
  const listeners = new Set<() => void>();
  let buffer = '';
  res.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as ServerEvent);
      }
    }
    for (const listener of listeners) listener();
  });

  const waitFor = (predicate: (e: ServerEvent) => boolean, timeoutMs = 2_000) =>
    new Promise<ServerEvent>((resolve, reject) => {
      const check = () => {
        const found = events.find(predicate);
        if (!found) return;
        listeners.delete(check);
        clearTimeout(timer);
        resolve(found);
      };
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`timed out waiting for event; got ${JSON.stringify(events)}`));
      }, timeoutMs);
      listeners.add(check);
      check();
    });

  const close = async () => {
    req.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };

  return { status: res.statusCode, headers: res.headers, events, waitFor, close };
}

const cookieFor = (t: TestApp, userId: string) => `${SESSION_COOKIE}=${createSession({ db: t.db, now: t.clock.now }, userId)}`;

describe('GET /api/notifications', () => {
  let t: TestApp;
  const ctx = () => ({ db: t.db, now: t.clock.now });
  beforeEach(() => {
    t = createTestApp();
  });

  function seedNotifications(userId: string, count: number): AppNotification[] {
    const created: AppNotification[] = [];
    for (let i = 0; i < count; i += 1) {
      t.clock.advance(0.1);
      created.push(notify(ctx(), userId, { type: 'load_match', title: `Load ${i}`, body: `body ${i}`, link: `/driver/loads/${i}` }));
    }
    return created;
  }

  it('lists my notifications newest first with the unread count', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    const { user: other } = seedUser(t, { role: 'driver' });
    const mine = seedNotifications(user.id, 3);
    seedNotifications(other.id, 2);

    const res = await c.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(3);
    expect(res.body.notifications.map((n: AppNotification) => n.id)).toEqual(mine.map((n) => n.id).reverse());
    expect(res.body.notifications[0]).toEqual({
      id: mine[2].id,
      type: 'load_match',
      title: 'Load 2',
      body: 'body 2',
      link: '/driver/loads/2',
      createdAt: mine[2].createdAt,
      readAt: null,
    });
  });

  it('orders notifications created in the same instant by insertion', async () => {
    const { c, user } = seedUser(t, { role: 'shipper' });
    const a = notify(ctx(), user.id, { type: 'booking_request', title: 'first' });
    const b = notify(ctx(), user.id, { type: 'booking_request', title: 'second' });
    const res = await c.get('/api/notifications');
    expect(res.body.notifications.map((n: AppNotification) => n.id)).toEqual([b.id, a.id]);
  });

  it('filters to unread and applies the limit, keeping the total unread count', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    const created = seedNotifications(user.id, 5);
    await c.post('/api/notifications/read', { ids: [created[4].id, created[1].id] });

    const unread = await c.get('/api/notifications?unread=1');
    expect(unread.body.notifications.map((n: AppNotification) => n.id)).toEqual([created[3].id, created[2].id, created[0].id]);
    expect(unread.body.unreadCount).toBe(3);
    expect((await c.get('/api/notifications?unread=true')).body.notifications).toHaveLength(3);
    expect((await c.get('/api/notifications?unread=0')).body.notifications).toHaveLength(5);
    expect((await c.get('/api/notifications?unread=')).body.notifications).toHaveLength(5);

    const limited = await c.get('/api/notifications?limit=2');
    expect(limited.body.notifications.map((n: AppNotification) => n.id)).toEqual([created[4].id, created[3].id]);
    expect(limited.body.unreadCount).toBe(3);
  });

  it('returns 50 by default and at most 100', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    seedNotifications(user.id, 105);
    expect((await c.get('/api/notifications')).body.notifications).toHaveLength(50);
    expect((await c.get('/api/notifications?limit=100')).body.notifications).toHaveLength(100);
    expect((await c.get('/api/notifications?limit=1')).body.notifications).toHaveLength(1);
  });

  it('validates the query', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    for (const query of ['limit=0', 'limit=101', 'limit=ten', 'unread=maybe']) {
      const res = await c.get(`/api/notifications?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('is 401 when signed out', async () => {
    expect((await client(t.app).get('/api/notifications')).status).toBe(401);
  });
});

describe('POST /api/notifications/read', () => {
  let t: TestApp;
  const ctx = () => ({ db: t.db, now: t.clock.now });
  beforeEach(() => {
    t = createTestApp();
  });

  it('marks the given ids read and returns the new unread count', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    const a = notify(ctx(), user.id, { type: 'load_match', title: 'a' });
    const b = notify(ctx(), user.id, { type: 'load_match', title: 'b' });
    notify(ctx(), user.id, { type: 'load_match', title: 'c' });
    t.clock.advance(1);

    const res = await c.post('/api/notifications/read', { ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 1 });
    const list = (await c.get('/api/notifications')).body.notifications as AppNotification[];
    expect(list.find((n) => n.id === a.id)?.readAt).toBe(t.clock.now().toISOString());

    // Marking again keeps the first read time.
    t.clock.advance(1);
    await c.post('/api/notifications/read', { ids: [a.id] });
    const again = (await c.get('/api/notifications')).body.notifications as AppNotification[];
    expect(again.find((n) => n.id === a.id)?.readAt).toBe(list.find((n) => n.id === a.id)?.readAt);
  });

  it('marks everything read when ids are omitted, and nothing for an empty list', async () => {
    const { c, user } = seedUser(t, { role: 'shipper' });
    notify(ctx(), user.id, { type: 'booking_request', title: 'a' });
    notify(ctx(), user.id, { type: 'booking_request', title: 'b' });
    expect((await c.post('/api/notifications/read', { ids: [] })).body).toEqual({ unreadCount: 2 });
    expect((await c.post('/api/notifications/read')).body).toEqual({ unreadCount: 0 });
    expect((await c.get('/api/notifications?unread=1')).body.notifications).toEqual([]);
  });

  it("never touches another user's notifications", async () => {
    const alice = seedUser(t, { role: 'driver' });
    const bob = seedUser(t, { role: 'driver' });
    const mine = notify(ctx(), alice.user.id, { type: 'load_match', title: 'mine' });
    const theirs = notify(ctx(), bob.user.id, { type: 'load_match', title: 'theirs' });

    expect((await alice.c.post('/api/notifications/read', { ids: [theirs.id, mine.id] })).body).toEqual({ unreadCount: 0 });
    expect((await bob.c.get('/api/notifications')).body).toMatchObject({ unreadCount: 1 });

    await alice.c.post('/api/notifications/read');
    const bobs = (await bob.c.get('/api/notifications')).body;
    expect(bobs.unreadCount).toBe(1);
    expect(bobs.notifications[0]).toMatchObject({ id: theirs.id, readAt: null });
  });

  it('validates the body, needs the CSRF header and a session', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    expect((await c.post('/api/notifications/read', { ids: 'all' })).status).toBe(400);
    expect((await c.post('/api/notifications/read', { ids: [42] })).status).toBe(400);
    const csrf = await c.agent.post('/api/notifications/read').send({});
    expect(csrf.status).toBe(403);
    expect(csrf.body.error.code).toBe('csrf');
    expect((await client(t.app).post('/api/notifications/read')).status).toBe(401);
  });
});

describe('GET /api/events', () => {
  let t: TestApp;
  let streams: Awaited<ReturnType<typeof openEventStream>>[] = [];
  beforeEach(() => {
    t = createTestApp();
    streams = [];
  });
  afterEach(async () => {
    await Promise.all(streams.map((s) => s.close()));
  });

  it('is 401 when signed out', async () => {
    const res = await client(t.app).get('/api/events');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('streams a hello and then live notifications for this user only', async () => {
    const { user } = seedUser(t, { role: 'driver' });
    const { user: other } = seedUser(t, { role: 'driver' });
    const stream = await openEventStream(t.app, cookieFor(t, user.id));
    streams.push(stream);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/text\/event-stream/);
    expect(await stream.waitFor((e) => e.type === 'hello')).toEqual({ type: 'hello', userId: user.id });
    expect(connectedClientCount(user.id)).toBe(1);

    notify({ db: t.db, now: t.clock.now }, other.id, { type: 'load_match', title: 'Not for you' });
    const sent = notify({ db: t.db, now: t.clock.now }, user.id, { type: 'load_match', title: 'Hot match near you' });
    const event = await stream.waitFor((e) => e.type === 'notification');
    expect(event).toEqual({ type: 'notification', notification: sent });
    expect(stream.events.filter((e) => e.type === 'notification')).toHaveLength(1);
  });

  it('drops the connection from the registry when the client goes away', async () => {
    const { user } = seedUser(t, { role: 'shipper' });
    const stream = await openEventStream(t.app, cookieFor(t, user.id));
    await stream.waitFor((e) => e.type === 'hello');
    expect(connectedClientCount(user.id)).toBe(1);
    await stream.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectedClientCount(user.id)).toBe(0);
  });
});

describe('saved searches', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  const filters = { equipment: ['HS_GOOSENECK'], originCityId: 'odessa-tx', originRadiusMiles: 150, minRatePerMile: 1.8 };

  it('creates, lists newest first, updates and deletes', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const first = await c.post('/api/saved-searches', { name: '  Permian gooseneck  ', filters });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: expect.any(String),
      name: 'Permian gooseneck',
      filters,
      alertsEnabled: true,
      createdAt: t.clock.now().toISOString(),
    });
    t.clock.advance(1);
    const second = await c.post('/api/saved-searches', {
      name: 'Back to Texas',
      filters: { destinationStates: ['TX'], hazmat: false },
      alertsEnabled: false,
    });
    expect(second.status).toBe(201);
    expect(second.body.alertsEnabled).toBe(false);

    const list = await c.get('/api/saved-searches');
    expect(list.status).toBe(200);
    expect(list.body.map((s: SavedSearch) => s.id)).toEqual([second.body.id, first.body.id]);

    const renamed = await c.patch(`/api/saved-searches/${first.body.id}`, { name: 'Permian, any rate', alertsEnabled: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ ...first.body, name: 'Permian, any rate', alertsEnabled: false });

    const refiltered = await c.patch(`/api/saved-searches/${first.body.id}`, { filters: { q: 'pipe' } });
    expect(refiltered.body).toMatchObject({ name: 'Permian, any rate', alertsEnabled: false, filters: { q: 'pipe' } });

    expect((await c.delete(`/api/saved-searches/${first.body.id}`)).status).toBe(204);
    expect((await c.get('/api/saved-searches')).body.map((s: SavedSearch) => s.id)).toEqual([second.body.id]);
    expect((await c.delete(`/api/saved-searches/${first.body.id}`)).status).toBe(404);
  });

  it('strips unknown filter keys and accepts empty filters', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.post('/api/saved-searches', { name: 'Anything that fits', filters: { sort: 'rate', bogus: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.filters).toEqual({ sort: 'rate' });
    expect((await c.post('/api/saved-searches', { name: 'All', filters: {} })).status).toBe(201);
  });

  it.each([
    ['a missing name', { filters }],
    ['an empty name', { name: '  ', filters }],
    ['a name over 60 characters', { name: 'n'.repeat(61), filters }],
    ['missing filters', { name: 'No filters' }],
    ['an unknown equipment code', { name: 'x', filters: { equipment: ['HOVERCRAFT'] } }],
    ['an unknown origin city', { name: 'x', filters: { originCityId: 'atlantis-xx' } }],
    ['an invalid state', { name: 'x', filters: { destinationStates: ['ZZ'] } }],
    ['a radius out of range', { name: 'x', filters: { originRadiusMiles: 5000 } }],
    ['a bad sort', { name: 'x', filters: { sort: 'cheapest' } }],
    ['a non-boolean alertsEnabled', { name: 'x', filters: {}, alertsEnabled: 'yes' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.post('/api/saved-searches', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('validates PATCH bodies too', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const created = await c.post('/api/saved-searches', { name: 'Mine', filters });
    expect((await c.patch(`/api/saved-searches/${created.body.id}`, { filters: { equipment: ['NOPE'] } })).status).toBe(400);
    expect((await c.patch(`/api/saved-searches/${created.body.id}`, { name: '' })).status).toBe(400);
    expect((await c.get('/api/saved-searches')).body[0]).toEqual(created.body);
  });

  it(`allows at most ${MAX_SAVED_SEARCHES} per driver`, async () => {
    const { c } = seedUser(t, { role: 'driver' });
    for (let i = 0; i < MAX_SAVED_SEARCHES; i += 1) {
      expect((await c.post('/api/saved-searches', { name: `Search ${i}`, filters: {} })).status).toBe(201);
    }
    const res = await c.post('/api/saved-searches', { name: 'One too many', filters: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('saved_search_limit');

    // The limit is per driver.
    const { c: other } = seedUser(t, { role: 'driver' });
    expect((await other.post('/api/saved-searches', { name: 'Mine', filters: {} })).status).toBe(201);

    // Deleting one frees a slot.
    const [newest] = (await c.get('/api/saved-searches')).body as SavedSearch[];
    await c.delete(`/api/saved-searches/${newest.id}`);
    expect((await c.post('/api/saved-searches', { name: 'Replacement', filters: {} })).status).toBe(201);
  });

  it("hides other drivers' searches and answers 404 for them", async () => {
    const alice = seedUser(t, { role: 'driver' });
    const bob = seedUser(t, { role: 'driver' });
    const created = await alice.c.post('/api/saved-searches', { name: 'Alice only', filters });

    expect((await bob.c.get('/api/saved-searches')).body).toEqual([]);
    expect((await bob.c.patch(`/api/saved-searches/${created.body.id}`, { name: 'Stolen' })).status).toBe(404);
    expect((await bob.c.delete(`/api/saved-searches/${created.body.id}`)).status).toBe(404);
    expect((await alice.c.get('/api/saved-searches')).body).toEqual([created.body]);
  });

  it('is for drivers only and needs the CSRF header', async () => {
    const { c: shipper } = seedUser(t, { role: 'shipper' });
    expect((await shipper.get('/api/saved-searches')).status).toBe(403);
    expect((await shipper.post('/api/saved-searches', { name: 'x', filters: {} })).status).toBe(403);
    expect((await client(t.app).get('/api/saved-searches')).status).toBe(401);

    const { c: driver } = seedUser(t, { role: 'driver' });
    const res = await driver.agent.post('/api/saved-searches').send({ name: 'x', filters: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
});
