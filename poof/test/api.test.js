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

test('username availability: same rule as sign up, no session needed', async () => {
  const s = await boot();
  try {
    const c = client(s.base);
    const available = async (name) => (await c.get('/api/users/available?username=' + encodeURIComponent(name))).data;
    assert.deepEqual(await available('ava'), { available: true, reason: null });
    assert.deepEqual(await available('x'), {
      available: false, reason: 'Usernames are 3-20 letters, numbers, dots or underscores.',
    });
    assert.equal((await c.get('/api/users/available')).data.available, false, 'missing username');
    await client(s.base).post('/api/signup', { username: 'ava', password: 'password1' });
    for (const taken of ['ava', 'AVA', '  Ava ']) {
      assert.deepEqual(await available(taken), { available: false, reason: 'That username is taken.' }, taken);
    }
    assert.equal((await c.get('/api/me')).status, 401, 'checking never starts a session');
    // whatever the check says is exactly what sign up then does
    for (const name of ['ab', 'abc', 'a'.repeat(20), 'a'.repeat(21), 'with space', 'dots.ok', 'under_score',
      'Mixed.Case', 'semi;colon', '<b>', 'ava']) {
      const said = await available(name);
      const signup = await client(s.base).post('/api/signup', { username: name, password: 'password1' });
      assert.equal(said.available, signup.status === 200, `${name}: check said ${said.available}, sign up gave ${signup.status}`);
      if (!said.available) assert.equal(said.reason, signup.data.error, name);
    }
  } finally { await s.close(); }
});

test('username availability is rate limited, apart from log in attempts', async () => {
  const s = await boot();
  try {
    const c = client(s.base);
    for (let i = 0; i < 30; i++) assert.equal((await c.get('/api/users/available?username=name' + i)).status, 200);
    const blocked = await c.get('/api/users/available?username=one_more');
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /Too many attempts/);
    // typing usernames never uses up someone's sign up or log in tries
    assert.equal((await c.post('/api/signup', { username: 'ava', password: 'password1' })).status, 200);
    assert.equal((await c.post('/api/login', { username: 'ava', password: 'password1' })).status, 200);
    s.clock.t += 15 * 60 * 1000 + 1;
    assert.equal((await c.get('/api/users/available?username=later')).status, 200, 'the window resets');
  } finally { await s.close(); }
});

test('the launch splash is in the page before any script, drawn from mascot.js', async () => {
  const s = await boot();
  try {
    const html = await (await fetch(s.base + '/')).text();
    const splash = html.indexOf('<div id="splash"');
    assert.ok(splash > 0 && splash < html.indexOf('<script'), 'splash markup comes before the scripts');
    const window = {};
    window.window = window;
    const vm = require('node:vm');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mascot.js'), 'utf8'), vm.createContext(window));
    const mark = window.mascotSVG('happy', 160, '', 'mark', '#ffffff').replace(/pf\d+k/g, 'splash-k');
    assert.ok(html.includes(`<div id="splash" aria-hidden="true">${mark}</div>`), 'splash is the solid white Puff mark');
    assert.match(html, /<meta name="theme-color" content="#6d4cff">/);
    const manifest = await (await fetch(s.base + '/manifest.webmanifest')).json();
    assert.equal(manifest.background_color, '#6d4cff');
  } finally { await s.close(); }
});

test('profile by username: friendship status from each side, needs a session', async () => {
  const s = await boot();
  try {
    const a = client(s.base);
    const b = client(s.base);
    const ra = await a.post('/api/signup', { username: 'ava', password: 'password1', displayName: 'Ava' });
    await b.post('/api/signup', { username: 'ben', password: 'password2', displayName: 'Ben' });
    const avatar = { expr: 4, face: 1, skin: 2, eyeColor: 3, hair: 3, hairColor: 4, beard: 0, acc: 2, shirt: 5, bg: 1 };
    await a.post('/api/me/avatar', { avatar });
    const look = async (c, name) => c.get('/api/users/by-username/' + name);

    assert.equal((await client(s.base).get('/api/users/by-username/ava')).status, 401, 'needs a session');
    const seen = await look(b, 'ava');
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.data, { id: ra.data.id, username: 'ava', displayName: 'Ava', avatar, status: 'none' });
    assert.ok(!('hash' in seen.data) && !('salt' in seen.data), 'only public fields');
    assert.equal((await look(b, 'AVA')).data.username, 'ava', 'any case');
    assert.equal((await look(a, 'ava')).data.status, 'self');

    await b.post('/api/friends/request', { username: 'ava' });
    assert.equal((await look(b, 'ava')).data.status, 'requested', 'ben asked ava');
    assert.equal((await look(a, 'ben')).data.status, 'incoming', 'ava sees the request');
    await a.post('/api/friends/request', { username: 'ben' }); // adding back accepts
    assert.equal((await look(a, 'ben')).data.status, 'friends');
    assert.equal((await look(b, 'ava')).data.status, 'friends');

    const missing = await look(b, 'nobody');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'No one by that username.');
    assert.equal((await look(b, '%E0%A4%A')).status, 400, 'a broken address is a bad request, not a crash');
    assert.equal((await look(b, '%3Cscript%3E')).status, 404);
  } finally { await s.close(); }
});

test('/add/<username> links open the app (the page a Puffcode points at)', async () => {
  const s = await boot();
  try {
    for (const p of ['/add/ava', '/add/ava.b_c', '/add/ava/']) {
      const res = await fetch(s.base + p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('content-type'), /^text\/html/, p);
      const html = await res.text();
      assert.ok(html.includes('<main id="app"'), `${p} serves the app`);
      for (const src of ['/qr.js', '/puffcode.js', '/app.js']) assert.ok(html.includes(`<script src="${src}">`), `${p} loads ${src}`);
    }
    // the app's scripts load from the root, so they work from /add/<username> too
    assert.equal((await fetch(s.base + '/puffcode.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  } finally { await s.close(); }
});
