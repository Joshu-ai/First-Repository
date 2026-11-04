'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, LIMITS } = require('../server');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// Stand-in clips: the first bytes of a real WebM (the EBML magic) and of a
// real MP4 (a box size, then "ftyp"), padded out to `size` bytes
const webmBytes = (size = 256) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);
const mp4Bytes = (size = 256) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(size - 12, 7)]);
const dataUrl = (type, buf) => `data:${type};base64,` + buf.toString('base64');
const WEBM = dataUrl('video/webm', webmBytes());
const MP4 = dataUrl('video/mp4', mp4Bytes());
const DAY = 24 * 3600 * 1000;

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-'));
  const clock = { t: Date.UTC(2026, 9, 26, 12) };
  const app = createApp({ dataDir, now: () => clock.t });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  // an event stream a test has stopped reading can leave its socket open, so close them all
  const close = () => new Promise((r) => { app.server.close(r); app.server.closeAllConnections(); });
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
  // fetch with this client's session, for responses that are not JSON
  const raw = (p, headers = {}, opts = {}) => fetch(base + p, { headers: { cookie, ...headers }, ...opts });
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), raw };
}

// A client's live event stream (/api/events): `events` fills as they
// arrive. until(type) waits for the next event of that type after the
// call, so call it before whatever sends the event, then await it.
async function listen(c) {
  const stop = new AbortController();
  const res = await c.raw('/api/events', {}, { signal: stop.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const events = [];
  const waiting = new Set();
  const decoder = new TextDecoder();
  let buf = '';
  const pump = (async () => {
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buf.indexOf('\n\n')) >= 0) {
          const data = buf.slice(0, end).split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          buf = buf.slice(end + 2);
          if (data) events.push(JSON.parse(data));
          for (const w of waiting) w();
        }
      }
    } catch (e) { if (e.name !== 'AbortError') throw e; }
  })();
  const until = (type, count = events.filter((e) => e.type === type).length + 1) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(check); reject(new Error(`no "${type}" event`)); }, 2000);
    function check() {
      const found = events.filter((e) => e.type === type);
      if (found.length < count) return;
      clearTimeout(timer);
      waiting.delete(check);
      resolve(found.at(-1));
    }
    waiting.add(check);
    check();
  });
  const close = async () => { stop.abort(); await pump; };
  return { events, until, close };
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

test('friend card: each inbox row carries who they are and the streak; Remove friend ends it both ways', async () => {
  const s = await boot();
  try {
    const { a, b, aId, bId } = await friends(s.base);
    const avatar = { expr: 1, face: 0, skin: 3, eyeColor: 2, hair: 2, hairColor: 1, beard: 0, acc: 0, shirt: 2, bg: 3 };
    await b.post('/api/me/avatar', { avatar });
    // the card shows avatar, name, @username and streak straight from the row: no other call
    const row = (await a.get('/api/inbox')).data[0];
    assert.deepEqual(Object.keys(row.friend).sort(), ['avatar', 'displayName', 'id', 'username'], 'public fields only');
    assert.deepEqual(row.friend, { id: bId, username: 'ben', displayName: 'Ben', avatar });
    assert.equal(row.streak, 0);
    for (let day = 0; day < 3; day++) {
      await a.post('/api/snaps', { to: [bId], image: PNG });
      await b.post('/api/snaps', { to: [aId], image: PNG });
      s.clock.t += DAY;
    }
    assert.equal((await a.get('/api/inbox')).data[0].streak, 3, 'the streak the card shows');
    assert.equal((await b.get('/api/inbox')).data[0].streak, 3, 'the same from both sides');
    // Remove friend: gone from both inboxes, no more snaps or chats, and a second try says so
    assert.equal((await a.post('/api/friends/remove', { userId: bId })).status, 200);
    assert.deepEqual((await a.get('/api/inbox')).data, []);
    assert.deepEqual((await b.get('/api/inbox')).data, []);
    assert.equal((await b.post('/api/snaps', { to: [aId], image: PNG })).status, 403);
    assert.equal((await b.post('/api/chat/' + aId, { text: 'hi' })).status, 403);
    assert.equal((await a.post('/api/friends/remove', { userId: bId })).status, 404);
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

test('typing: passed on to the friend live and never stored; at most once a second until a message', async () => {
  const s = await boot();
  try {
    const { a, b, aId, bId } = await friends(s.base);
    const live = await listen(b);
    const typings = () => live.events.filter((e) => e.type === 'typing').length;
    try {
      const typed = live.until('typing');
      const first = await a.post(`/api/chat/${bId}/typing`);
      assert.deepEqual([first.status, first.data], [200, { ok: true }]);
      assert.deepEqual(await typed, { type: 'typing', from: aId });
      // another within the second is answered but not passed on: the story posted after it arrives first
      s.clock.t += 999;
      assert.equal((await a.post(`/api/chat/${bId}/typing`)).status, 200);
      const story = live.until('story');
      await a.post('/api/snaps', { to: [], story: true, image: PNG });
      await story;
      assert.equal(typings(), 1);
      // a second after the last one passed on, it is passed on again
      s.clock.t += 1;
      const again = live.until('typing');
      await a.post(`/api/chat/${bId}/typing`);
      assert.deepEqual(await again, { type: 'typing', from: aId });
      // and a message starts the count afresh: the next keystroke is passed on straight away
      const message = live.until('message');
      await a.post('/api/chat/' + bId, { text: 'hi' });
      await message;
      const next = live.until('typing');
      await a.post(`/api/chat/${bId}/typing`);
      await next;
      assert.equal(typings(), 3);
    } finally { await live.close(); }
    // nothing about typing is kept: the one message is all there is
    assert.equal(s.app.store.db.messages.length, 1);
    assert.equal(JSON.stringify(s.app.store.db).includes('typing'), false);
    const inbox = (await b.get('/api/inbox')).data[0];
    assert.deepEqual([inbox.status, inbox.unread], ['new-chat', 1]);
  } finally { await s.close(); }
});

test('typing to someone who is not a friend is 403, and they hear nothing', async () => {
  const s = await boot();
  try {
    const { a, aId, bId } = await friends(s.base);
    const zed = client(s.base);
    const zedId = (await zed.post('/api/signup', { username: 'zed', password: 'password1' })).data.id;
    const live = await listen(zed);
    try {
      assert.equal((await a.post(`/api/chat/${zedId}/typing`)).status, 403, 'a stranger');
      const asked = live.until('friends');
      await a.post('/api/friends/request', { username: 'zed' });
      await asked;
      assert.equal((await a.post(`/api/chat/${zedId}/typing`)).status, 403, 'asked, not yet accepted');
      assert.equal((await zed.post(`/api/chat/${aId}/typing`)).status, 403, 'nor the other way');
      assert.equal((await zed.post(`/api/chat/${bId}/typing`)).status, 403);
      assert.equal((await a.post('/api/chat/nobody/typing')).status, 403, 'no one at all');
      assert.equal((await a.post(`/api/chat/${aId}/typing`)).status, 403, 'yourself');
      const removed = live.until('friends');
      await a.post('/api/friends/remove', { userId: zedId });
      await removed;
      assert.deepEqual(live.events.map((e) => e.type), ['friends', 'friends'], 'no typing event reached zed');
    } finally { await live.close(); }
    assert.equal((await client(s.base).post(`/api/chat/${bId}/typing`)).status, 401, 'needs a session');
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

test('a video snap opens once with its caption, and its file is deleted', async () => {
  const s = await boot();
  try {
    const { a, b, bId } = await friends(s.base);
    const mediaDir = path.join(s.dataDir, 'media');
    const sent = await a.post('/api/snaps', { to: [bId], video: WEBM, caption: '  Puff   says\nhi  ', duration: 2.345, mirror: true });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.sent, 1);
    assert.deepEqual(fs.readdirSync(mediaDir).map((f) => path.extname(f)), ['.webm'], 'stored as a .webm file');
    const inbox = (await b.get('/api/inbox')).data;
    assert.equal(inbox[0].status, 'new-snap');
    const id = inbox[0].snapIds[0];
    assert.equal((await a.post(`/api/snaps/${id}/open`)).status, 404, 'the sender cannot open it');
    const opened = await b.post(`/api/snaps/${id}/open`);
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.data, { video: WEBM, caption: 'Puff says hi', duration: 2.3, mirror: true });
    assert.ok(!('image' in opened.data));
    assert.equal(fs.readdirSync(mediaDir).length, 0, 'media deleted after open');
    assert.equal((await b.post(`/api/snaps/${id}/open`)).status, 410, 'a video opens once too');
    assert.equal((await a.get('/api/inbox')).data[0].status, 'opened');

    // MP4 (what Safari records) works the same; no caption is an empty one,
    // and the length is capped at 10 seconds
    await a.post('/api/snaps', { to: [bId], video: MP4, duration: 42 });
    assert.deepEqual(fs.readdirSync(mediaDir).map((f) => path.extname(f)), ['.mp4'], 'stored as a .mp4 file');
    const id2 = (await b.get('/api/inbox')).data[0].snapIds[0];
    assert.deepEqual((await b.post(`/api/snaps/${id2}/open`)).data, { video: MP4, caption: '', duration: 10, mirror: false });
    assert.equal(fs.readdirSync(mediaDir).length, 0);

    // a photo snap still answers with an image and its timer
    await a.post('/api/snaps', { to: [bId], image: PNG, duration: 3, caption: 'ignored' });
    const id3 = (await b.get('/api/inbox')).data[0].snapIds[0];
    assert.deepEqual(Object.keys((await b.post(`/api/snaps/${id3}/open`)).data).sort(), ['duration', 'image']);
  } finally { await s.close(); }
});

test('video snaps must really be WebM or MP4; captions are tidied and capped', async () => {
  const s = await boot();
  try {
    const { a, b, bId } = await friends(s.base);
    const post = (video, more = {}) => a.post('/api/snaps', { to: [bId], video, ...more });
    for (const bad of [
      dataUrl('video/ogg', webmBytes()), // not a type Poof keeps
      dataUrl('video/webm', mp4Bytes()), // labelled WebM, isn't one
      dataUrl('video/mp4', webmBytes()), // labelled MP4, isn't one
      'data:text/html;base64,PGgxPg==', 'not a data url', 42, { evil: true },
    ]) {
      const r = await post(bad);
      assert.equal(r.status, 400, String(bad).slice(0, 30));
      assert.equal(r.data.error, 'Video must be a WebM or MP4.');
    }
    // a real recording (Chromium's MediaRecorder) passes the same checks
    const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'clip-with-sound.webm'));
    assert.equal((await post(dataUrl('video/webm', real))).status, 200);
    // the label may carry codecs, as browsers write them
    assert.equal((await post(WEBM.replace('video/webm', 'video/webm;codecs=vp8'))).status, 200);
    assert.equal((await post(WEBM, { caption: 'x'.repeat(200) })).status, 200);
    assert.equal((await post(WEBM, { caption: { not: 'text' } })).status, 200);
    const ids = (await b.get('/api/inbox')).data[0].snapIds;
    const captions = [];
    for (const id of ids) captions.push((await b.post(`/api/snaps/${id}/open`)).data.caption);
    assert.deepEqual(captions, ['', '', 'x'.repeat(80), '']);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'media')).length, 0, 'nothing left behind by the rejected ones');
  } finally { await s.close(); }
});

test('video size limits: 413 for big clips, and only snaps take big bodies', async () => {
  const s = await boot();
  try {
    const { a, b, aId, bId } = await friends(s.base);
    assert.ok(LIMITS.video < LIMITS.snapBody * 0.75 && LIMITS.snapBody > LIMITS.body);
    // a clip under the limit goes through, even though its body is over 6 MB
    const big = dataUrl('video/webm', webmBytes(LIMITS.video - 1024));
    assert.ok(big.length > LIMITS.body, 'the body is bigger than other routes allow');
    assert.equal((await a.post('/api/snaps', { to: [bId], video: big, duration: 9 })).status, 200);
    const id = (await b.get('/api/inbox')).data[0].snapIds[0];
    assert.equal((await b.post(`/api/snaps/${id}/open`)).data.video, big, 'and comes back whole');
    // one byte over the video limit
    const over = await a.post('/api/snaps', { to: [bId], video: dataUrl('video/webm', webmBytes(LIMITS.video + 1)) });
    assert.equal(over.status, 413);
    assert.equal(over.data.error, 'Video is too large.');
    // a body over the snap limit is refused, and the client hears it (no reset connection)
    const huge = await a.post('/api/snaps', { to: [bId], video: 'data:video/webm;base64,' + 'A'.repeat(LIMITS.snapBody) });
    assert.equal(huge.status, 413);
    assert.equal(huge.data.error, 'Too large.');
    // photos keep their own limit inside the bigger body
    const bigPhoto = await a.post('/api/snaps', { to: [bId], image: 'data:image/png;base64,' + 'A'.repeat(Math.ceil(LIMITS.image * 4 / 3) + 8) });
    assert.equal(bigPhoto.status, 413);
    assert.equal(bigPhoto.data.error, 'Image is too large.');
    // every other route keeps the 6 MB cap
    const chat = await a.post('/api/chat/' + bId, { text: 'x'.repeat(LIMITS.body + 1) });
    assert.equal(chat.status, 413);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'media')).length, 0, 'nothing stored from refused uploads');
    // and the server carries on as normal
    assert.equal((await a.post('/api/chat/' + bId, { text: 'still here' })).status, 200);
    assert.equal((await b.get('/api/chat/' + aId)).data.messages[0].text, 'still here');
  } finally { await s.close(); }
});

test('video stories: listed as video, served with the right type and byte ranges, gone after 24h', async () => {
  const s = await boot();
  try {
    const { a, b } = await friends(s.base);
    const stranger = client(s.base);
    await stranger.post('/api/signup', { username: 'zed', password: 'password1' });
    await a.post('/api/snaps', { to: [], story: true, image: PNG, duration: 4 });
    await a.post('/api/snaps', { to: [], story: true, video: WEBM, caption: 'my day', duration: 3.21, mirror: true });
    await a.post('/api/snaps', { to: [], story: true, video: MP4, duration: 1 });
    const [photo, webm, mp4] = (await b.get('/api/stories')).data.friends[0].stories;
    assert.equal(photo.type, 'photo');
    assert.ok(!('caption' in photo));
    assert.deepEqual([webm.type, webm.caption, webm.duration, webm.mirror], ['video', 'my day', 3.2, true]);
    assert.deepEqual([mp4.type, mp4.caption, mp4.duration, mp4.mirror], ['video', '', 1, false]);
    assert.equal((await a.get('/api/stories')).data.mine[1].type, 'video', 'the poster sees it as video too');

    const whole = await b.raw(`/api/stories/${webm.id}/media`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'video/webm');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), webmBytes());
    assert.equal((await b.raw(`/api/stories/${mp4.id}/media`)).headers.get('content-type'), 'video/mp4');
    assert.equal((await b.raw(`/api/stories/${photo.id}/media`)).headers.get('content-type'), 'image/png');

    // ranges: the first bytes, an open end, the last bytes, and past the end
    const first = await b.raw(`/api/stories/${webm.id}/media`, { range: 'bytes=0-3' });
    assert.equal(first.status, 206);
    assert.equal(first.headers.get('content-range'), 'bytes 0-3/256');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), webmBytes().subarray(0, 4));
    const rest = await b.raw(`/api/stories/${webm.id}/media`, { range: 'bytes=250-' });
    assert.equal(rest.headers.get('content-range'), 'bytes 250-255/256');
    assert.equal((await rest.arrayBuffer()).byteLength, 6);
    const tail = await b.raw(`/api/stories/${webm.id}/media`, { range: 'bytes=-10' });
    assert.equal(tail.headers.get('content-range'), 'bytes 246-255/256');
    const past = await b.raw(`/api/stories/${webm.id}/media`, { range: 'bytes=999-' });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('content-range'), 'bytes */256');

    assert.equal((await stranger.raw(`/api/stories/${webm.id}/media`)).status, 404, 'friends only');
    assert.equal((await fetch(`${s.base}/api/stories/${webm.id}/media`)).status, 401, 'needs a session');
    s.clock.t += DAY + 1000;
    s.app.expire();
    assert.equal((await a.get('/api/stories')).data.mine.length, 0);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'media')).length, 0, 'video files go with their stories');
  } finally { await s.close(); }
});
