'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const DAY = 24 * 3600 * 1000;

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-'));
  const clock = { t: Date.UTC(2026, 9, 26, 12) };
  const app = createApp({ dataDir, now: () => clock.t });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const close = () => new Promise((r) => app.server.close(r));
  return { app, base, clock, dataDir, close };
}

function client(base) {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b) };
}

async function friends(base) {
  const a = client(base);
  const b = client(base);
  const ra = await a.post('/api/signup', { username: 'ava', password: 'password1', displayName: 'Ava' });
  const rb = await b.post('/api/signup', { username: 'ben', password: 'password2', displayName: 'Ben' });
  await a.post('/api/friends/request', { username: 'ben' });
  await b.post('/api/friends/accept', { userId: ra.data.id });
  return { a, b, aId: ra.data.id, bId: rb.data.id };
}

test('signup, login, logout and validation', async () => {
  const s = await boot();
  try {
    const c = client(s.base);
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal((await c.post('/api/signup', { username: 'x', password: 'password1' })).status, 400);
    assert.equal((await c.post('/api/signup', { username: 'ava', password: 'short' })).status, 400);
    assert.equal((await c.post('/api/signup', { username: 'Ava', password: 'password1' })).status, 200);
    assert.equal((await c.get('/api/me')).data.username, 'ava');
    assert.equal((await client(s.base).post('/api/signup', { username: 'ava', password: 'password1' })).status, 409);
    await c.post('/api/logout');
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal((await c.post('/api/login', { username: 'ava', password: 'nope-nope' })).status, 401);
    assert.equal((await c.post('/api/login', { username: 'AVA', password: 'password1' })).status, 200);
    const db = JSON.parse(JSON.stringify(s.app.store.db));
    assert.ok(!JSON.stringify(db.users).includes('password1'), 'password stored in plain text');
  } finally { await s.close(); }
});

test('avatars: saved, shown to friends, invalid parts rejected', async () => {
  const s = await boot();
  try {
    const { a, b } = await friends(s.base);
    const avatar = { expr: 4, face: 1, skin: 2, eyeColor: 3, hair: 3, hairColor: 4, beard: 0, acc: 2, shirt: 5, bg: 1 };
    assert.equal((await a.get('/api/me')).data.avatar, null);
    assert.deepEqual((await a.post('/api/me/avatar', { avatar })).data.avatar, avatar);
    assert.deepEqual((await b.get('/api/friends')).data.friends[0].avatar, avatar);
    assert.equal((await a.post('/api/me/avatar', { avatar: { ...avatar, hair: 99 } })).status, 400);
    assert.equal((await a.post('/api/me/avatar', { avatar: { ...avatar, expr: '<script>' } })).status, 400);
    const { expr, ...missing } = avatar;
    assert.equal((await a.post('/api/me/avatar', { avatar: missing })).status, 400);
    assert.ok(expr >= 0);
  } finally { await s.close(); }
});

test('writes must be JSON (blocks cross-site form posts)', async () => {
  const s = await boot();
  try {
    const res = await fetch(s.base + '/api/signup', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=eve&password=password1',
    });
    assert.equal(res.status, 415);
  } finally { await s.close(); }
});

test('friend requests: request, accept, add-back accepts, remove', async () => {
  const s = await boot();
  try {
    const a = client(s.base);
    const b = client(s.base);
    const c = client(s.base);
    const ra = await a.post('/api/signup', { username: 'ava', password: 'password1' });
    const rb = await b.post('/api/signup', { username: 'ben', password: 'password1' });
    await c.post('/api/signup', { username: 'cal', password: 'password1' });
    assert.equal((await a.post('/api/friends/request', { username: 'ben' })).data.status, 'pending');
    assert.equal((await b.get('/api/friends')).data.incoming[0].username, 'ava');
    assert.equal((await a.post('/api/friends/accept', { userId: rb.data.id })).status, 404, 'requester cannot self-accept');
    assert.equal((await b.post('/api/friends/accept', { userId: ra.data.id })).data.status, 'accepted');
    assert.equal((await a.get('/api/friends')).data.friends[0].username, 'ben');
    // cal asks ava, ava adding cal back accepts
    await c.post('/api/friends/request', { username: 'ava' });
    assert.equal((await a.post('/api/friends/request', { username: 'cal' })).data.status, 'accepted');
    const search = await a.get('/api/users/search?q=be');
    assert.equal(search.data[0].status, 'accepted');
    await a.post('/api/friends/remove', { userId: rb.data.id });
    assert.equal((await a.get('/api/friends')).data.friends.length, 1);
  } finally { await s.close(); }
});

test('a snap opens exactly once and its file is deleted', async () => {
  const s = await boot();
  try {
    const { a, b, bId, aId } = await friends(s.base);
    const sent = await a.post('/api/snaps', { to: [bId], image: PNG, duration: 3 });
    assert.equal(sent.data.sent, 1);
    const mediaDir = path.join(s.dataDir, 'media');
    assert.equal(fs.readdirSync(mediaDir).length, 1);
    let inbox = (await b.get('/api/inbox')).data;
    assert.equal(inbox[0].status, 'new-snap');
    assert.equal((await a.get('/api/inbox')).data[0].status, 'delivered');
    const id = inbox[0].snapIds[0];
    // the sender cannot open it
    assert.equal((await a.post(`/api/snaps/${id}/open`)).status, 404);
    const opened = await b.post(`/api/snaps/${id}/open`);
    assert.equal(opened.status, 200);
    assert.ok(opened.data.image.startsWith('data:image/png;base64,'));
    assert.equal(opened.data.duration, 3);
    assert.equal(fs.readdirSync(mediaDir).length, 0, 'media deleted after open');
    assert.equal((await b.post(`/api/snaps/${id}/open`)).status, 410);
    assert.equal((await a.get('/api/inbox')).data[0].status, 'opened');
    inbox = (await b.get('/api/inbox')).data;
    assert.equal(inbox[0].status, 'received');
    assert.ok(aId);
  } finally { await s.close(); }
});

test('snaps only go to friends and must be images', async () => {
  const s = await boot();
  try {
    const { a, bId } = await friends(s.base);
    const stranger = client(s.base);
    const rs = await stranger.post('/api/signup', { username: 'zed', password: 'password1' });
    assert.equal((await a.post('/api/snaps', { to: [rs.data.id], image: PNG })).status, 403);
    assert.equal((await a.post('/api/snaps', { to: [bId], image: 'data:text/html;base64,PGgxPg==' })).status, 400);
    assert.equal((await a.post('/api/snaps', { to: [], image: PNG })).status, 400);
  } finally { await s.close(); }
});

test('chat: read receipts, 24h expiry after reading, saved messages stay', async () => {
  const s = await boot();
  try {
    const { a, b, aId, bId } = await friends(s.base);
    await a.post('/api/chat/' + bId, { text: 'hello' });
    const keep = await a.post('/api/chat/' + bId, { text: 'keep me' });
    assert.equal((await b.get('/api/inbox')).data[0].status, 'new-chat');
    const thread = await b.get('/api/chat/' + aId);
    assert.equal(thread.data.messages.length, 2);
    await b.post(`/api/messages/${keep.data.id}/save`);
    assert.equal((await a.get('/api/inbox')).data[0].status, 'chat-opened');
    s.clock.t += DAY + 1000;
    s.app.expire();
    const after = await a.get('/api/chat/' + bId);
    assert.deepEqual(after.data.messages.map((m) => m.text), ['keep me']);
  } finally { await s.close(); }
});

test('stories: friends only, viewers tracked, gone after 24h', async () => {
  const s = await boot();
  try {
    const { a, b } = await friends(s.base);
    const stranger = client(s.base);
    await stranger.post('/api/signup', { username: 'zed', password: 'password1' });
    await a.post('/api/snaps', { to: [], story: true, image: PNG, duration: 4 });
    const seen = (await b.get('/api/stories')).data;
    assert.equal(seen.friends.length, 1);
    const id = seen.friends[0].stories[0].id;
    const media = await fetch(`${s.base}/api/stories/${id}/media`);
    assert.equal(media.status, 401, 'needs a session');
    assert.equal((await stranger.get('/api/stories')).data.friends.length, 0);
    assert.equal((await stranger.post(`/api/stories/${id}/view`)).status, 404);
    await b.post(`/api/stories/${id}/view`);
    await b.post(`/api/stories/${id}/view`);
    const mine = (await a.get('/api/stories')).data.mine;
    assert.deepEqual(mine[0].viewers.map((v) => v.username), ['ben']);
    assert.equal((await b.get('/api/stories')).data.friends[0].stories[0].seen, true);
    s.clock.t += DAY + 1000;
    s.app.expire();
    assert.equal((await a.get('/api/stories')).data.mine.length, 0);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'media')).length, 0);
  } finally { await s.close(); }
});

test('streaks count consecutive days both friends snap, and reset', async () => {
  const s = await boot();
  try {
    const { a, b, aId, bId } = await friends(s.base);
    const day = async () => {
      await a.post('/api/snaps', { to: [bId], image: PNG });
      await b.post('/api/snaps', { to: [aId], image: PNG });
    };
    const streak = async () => (await a.get('/api/friends')).data.friends[0].streak;
    await a.post('/api/snaps', { to: [bId], image: PNG });
    assert.equal(await streak(), 0, 'one-sided day does not count');
    await b.post('/api/snaps', { to: [aId], image: PNG });
    assert.equal(await streak(), 1);
    s.clock.t += DAY; await day();
    s.clock.t += DAY; await day();
    assert.equal(await streak(), 3);
    s.clock.t += 2 * DAY;
    assert.equal(await streak(), 0, 'missed a day');
    await day();
    assert.equal(await streak(), 1, 'starts over');
  } finally { await s.close(); }
});

test('static files cannot escape the public folder', async () => {
  const s = await boot();
  try {
    const res = await fetch(s.base + '/..%2fserver.js');
    const text = await res.text();
    assert.ok(!text.includes('createApp'), 'leaked server source');
  } finally { await s.close(); }
});
