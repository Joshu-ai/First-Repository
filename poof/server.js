'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MAX_BODY = 6 * 1024 * 1024;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function createApp({ dataDir, now = () => Date.now() } = {}) {
  const store = new Store(dataDir || path.join(__dirname, 'data'));
  const db = store.db;
  const streams = new Map(); // userId -> Set(res)
  const attempts = new Map(); // ip -> {count, reset}

  // ---------- helpers ----------
  const user = (id) => db.users.find((u) => u.id === id);
  const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.displayName };
  const pairKey = (a, b) => [a, b].sort().join('|');
  const friendship = (a, b) => db.friendships.find(
    (f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
  const areFriends = (a, b) => friendship(a, b)?.status === 'accepted';
  const friendIds = (id) => db.friendships
    .filter((f) => f.status === 'accepted' && (f.a === id || f.b === id))
    .map((f) => (f.a === id ? f.b : f.a));

  function push(userId, event) {
    const set = streams.get(userId);
    if (!set) return;
    for (const res of set) res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  function streakFor(a, b) {
    const s = db.streaks[pairKey(a, b)];
    if (!s) return 0;
    const yesterday = dayString(now() - DAY);
    return s.lastDay >= yesterday ? s.count : 0;
  }

  function recordStreak(from, to) {
    const key = pairKey(from, to);
    const s = db.streaks[key] || (db.streaks[key] = { days: {}, count: 0, lastDay: null });
    const today = dayString(now());
    s.days[from] = today;
    if (s.days[to] === today && s.lastDay !== today) {
      s.count = s.lastDay === dayString(now() - DAY) ? s.count + 1 : 1;
      s.lastDay = today;
    }
  }

  function parseImage(dataUrl) {
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) fail(400, 'Image must be a JPEG or PNG.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) fail(413, 'Image is too large.');
    return { buf, ext: m[1] === 'jpeg' ? 'jpg' : 'png' };
  }

  function expire() {
    const t = now();
    let changed = false;
    db.snaps = db.snaps.filter((s) => {
      const keep = !s.openedAt && t - s.createdAt < 30 * DAY;
      const keepRecord = keep || (s.openedAt && t - s.openedAt < 30 * DAY);
      if (!keep) store.deleteMedia(s.media), (s.media = null);
      if (!keepRecord) changed = true;
      return keepRecord;
    });
    const before = db.messages.length + db.stories.length;
    db.messages = db.messages.filter((m) => m.saved || !m.readAt || t - m.readAt < DAY);
    db.stories = db.stories.filter((s) => {
      if (t - s.createdAt < DAY) return true;
      store.deleteMedia(s.media);
      return false;
    });
    if (changed || before !== db.messages.length + db.stories.length) store.save();
  }

  function rateLimit(ip) {
    const t = now();
    const a = attempts.get(ip);
    if (!a || a.reset < t) return attempts.set(ip, { count: 1, reset: t + 15 * 60 * 1000 });
    if (++a.count > 30) fail(429, 'Too many attempts. Try again in a few minutes.');
  }

  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions[token] = userId;
    store.save();
    res.setHeader('Set-Cookie',
      `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json/.test(req.headers['content-type'] || '')) {
        return reject(new HttpError(415, 'Send JSON.'));
      }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch { reject(new HttpError(400, 'Bad JSON.')); }
      });
      req.on('error', reject);
    });
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler, auth: opts.auth !== false });
  };

  route('POST', '/api/signup', ({ body, res, ip }) => {
    rateLimit(ip);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 40) || username;
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      fail(400, 'Usernames are 3-20 letters, numbers, dots or underscores.');
    }
    if (password.length < 8) fail(400, 'Passwords need at least 8 characters.');
    if (db.users.some((u) => u.username === username)) fail(409, 'That username is taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    const u = { id: store.id(), username, displayName, salt, hash: hashPassword(password, salt), createdAt: now() };
    db.users.push(u);
    startSession(res, u.id);
    return publicUser(u);
  }, { auth: false });

  route('POST', '/api/login', ({ body, res, ip }) => {
    rateLimit(ip);
    const u = db.users.find((x) => x.username === String(body.username || '').trim().toLowerCase());
    const given = Buffer.from(hashPassword(String(body.password || ''), u ? u.salt : 'x'), 'hex');
    if (!u || !crypto.timingSafeEqual(given, Buffer.from(u.hash, 'hex'))) {
      fail(401, 'Wrong username or password.');
    }
    startSession(res, u.id);
    return publicUser(u);
  }, { auth: false });

  route('POST', '/api/logout', ({ req, res }) => {
    delete db.sessions[cookies(req).sid];
    store.save();
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });

  route('GET', '/api/me', ({ me }) => publicUser(me));

  route('GET', '/api/events', ({ me, res }) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    if (!streams.has(me.id)) streams.set(me.id, new Set());
    streams.get(me.id).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => { clearInterval(ping); streams.get(me.id)?.delete(res); });
    return undefined; // stream stays open
  });

  route('GET', '/api/users/search', ({ me, url }) => {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return db.users
      .filter((u) => u.id !== me.id && (u.username.includes(q) || u.displayName.toLowerCase().includes(q)))
      .slice(0, 20)
      .map((u) => ({ ...publicUser(u), status: friendship(me.id, u.id)?.status || null }));
  });

  route('GET', '/api/friends', ({ me }) => {
    const mine = db.friendships.filter((f) => f.a === me.id || f.b === me.id);
    const other = (f) => publicUser(user(f.a === me.id ? f.b : f.a));
    return {
      friends: mine.filter((f) => f.status === 'accepted')
        .map((f) => ({ ...other(f), streak: streakFor(f.a, f.b) }))
        .sort((x, y) => x.displayName.localeCompare(y.displayName)),
      incoming: mine.filter((f) => f.status === 'pending' && f.requester !== me.id).map(other),
      outgoing: mine.filter((f) => f.status === 'pending' && f.requester === me.id).map(other),
    };
  });

  route('POST', '/api/friends/request', ({ me, body }) => {
    const target = db.users.find((u) => u.username === String(body.username || '').toLowerCase());
    if (!target || target.id === me.id) fail(404, 'No one by that username.');
    const existing = friendship(me.id, target.id);
    if (existing) {
      // They already asked me: adding them back accepts.
      if (existing.status === 'pending' && existing.requester === target.id) {
        existing.status = 'accepted';
        store.save();
        push(target.id, { type: 'friends' });
      }
      return { status: existing.status };
    }
    db.friendships.push({ id: store.id(), a: me.id, b: target.id, requester: me.id, status: 'pending', createdAt: now() });
    store.save();
    push(target.id, { type: 'friends' });
    return { status: 'pending' };
  });

  route('POST', '/api/friends/accept', ({ me, body }) => {
    const f = friendship(me.id, body.userId);
    if (!f || f.status !== 'pending' || f.requester === me.id) fail(404, 'No request to accept.');
    f.status = 'accepted';
    store.save();
    push(body.userId, { type: 'friends' });
    return { status: 'accepted' };
  });

  route('POST', '/api/friends/remove', ({ me, body }) => {
    const f = friendship(me.id, body.userId);
    if (!f) fail(404, 'Not friends.');
    db.friendships = db.friendships.filter((x) => x !== f);
    store.save();
    push(body.userId, { type: 'friends' });
    return { ok: true };
  });

  route('POST', '/api/snaps', ({ me, body }) => {
    const to = Array.isArray(body.to) ? [...new Set(body.to)] : [];
    const story = body.story === true;
    if (!to.length && !story) fail(400, 'Pick at least one friend or your story.');
    if (to.some((id) => !areFriends(me.id, id))) fail(403, 'You can only snap friends.');
    const duration = body.duration === 0 ? 0 : Math.min(10, Math.max(1, Math.round(Number(body.duration) || 5)));
    const { buf, ext } = parseImage(body.image);
    for (const id of to) {
      db.snaps.push({ id: store.id(), from: me.id, to: id, media: store.putMedia(buf, ext), duration, createdAt: now(), openedAt: null });
      recordStreak(me.id, id);
      push(id, { type: 'snap', from: me.id });
    }
    if (story) {
      db.stories.push({ id: store.id(), userId: me.id, media: store.putMedia(buf, ext), duration: duration || 5, createdAt: now(), viewers: [] });
      for (const id of friendIds(me.id)) push(id, { type: 'story', from: me.id });
    }
    store.save();
    return { sent: to.length, story };
  });

  route('POST', '/api/snaps/:id/open', ({ me, params }) => {
    const s = db.snaps.find((x) => x.id === params.id && x.to === me.id);
    if (!s) fail(404, 'Snap not found.');
    if (s.openedAt || !s.media) fail(410, 'This snap has already been opened.');
    const type = s.media.endsWith('.png') ? 'png' : 'jpeg';
    const image = `data:image/${type};base64,` + store.readMedia(s.media).toString('base64');
    store.deleteMedia(s.media);
    s.media = null;
    s.openedAt = now();
    store.save();
    push(s.from, { type: 'opened', by: me.id });
    return { image, duration: s.duration };
  });

  route('GET', '/api/inbox', ({ me }) => {
    return friendIds(me.id).map((fid) => {
      const between = (x) => (x.from === me.id && x.to === fid) || (x.from === fid && x.to === me.id);
      const snaps = db.snaps.filter(between);
      const msgs = db.messages.filter(between);
      const newSnaps = snaps.filter((s) => s.to === me.id && !s.openedAt);
      const unread = msgs.filter((m) => m.to === me.id && !m.readAt).length;
      const last = [...snaps, ...msgs].sort((a, b) => b.createdAt - a.createdAt)[0];
      let status = 'tap-to-chat';
      if (newSnaps.length) status = 'new-snap';
      else if (unread) status = 'new-chat';
      else if (last && 'media' in last) {
        status = last.from === me.id ? (last.openedAt ? 'opened' : 'delivered') : 'received';
      } else if (last) status = last.from === me.id ? (last.readAt ? 'chat-opened' : 'chat-delivered') : 'chat-received';
      return {
        friend: publicUser(user(fid)),
        streak: streakFor(me.id, fid),
        status,
        snapIds: newSnaps.sort((a, b) => a.createdAt - b.createdAt).map((s) => s.id),
        unread,
        lastAt: last ? last.createdAt : 0,
      };
    }).sort((a, b) => b.lastAt - a.lastAt);
  });

  route('GET', '/api/chat/:friendId', ({ me, params }) => {
    const fid = params.friendId;
    if (!areFriends(me.id, fid)) fail(403, 'Not friends.');
    let changed = false;
    const list = db.messages.filter((m) => (m.from === me.id && m.to === fid) || (m.from === fid && m.to === me.id));
    for (const m of list) {
      if (m.to === me.id && !m.readAt) { m.readAt = now(); changed = true; }
    }
    if (changed) { store.save(); push(fid, { type: 'read', by: me.id }); }
    return { friend: publicUser(user(fid)), messages: list.map(({ id, from, text, createdAt, readAt, saved }) => ({ id, from, text, createdAt, readAt, saved })) };
  });

  route('POST', '/api/chat/:friendId', ({ me, params, body }) => {
    const fid = params.friendId;
    if (!areFriends(me.id, fid)) fail(403, 'Not friends.');
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) fail(400, 'Say something.');
    const m = { id: store.id(), from: me.id, to: fid, text, createdAt: now(), readAt: null, saved: false };
    db.messages.push(m);
    store.save();
    push(fid, { type: 'message', from: me.id });
    return m;
  });

  route('POST', '/api/messages/:id/save', ({ me, params }) => {
    const m = db.messages.find((x) => x.id === params.id && (x.from === me.id || x.to === me.id));
    if (!m) fail(404, 'Message not found.');
    m.saved = !m.saved;
    store.save();
    push(m.from === me.id ? m.to : m.from, { type: 'read', by: me.id });
    return { saved: m.saved };
  });

  route('GET', '/api/stories', ({ me }) => {
    const shape = (s) => ({
      id: s.id, createdAt: s.createdAt, duration: s.duration,
      seen: s.viewers.includes(me.id),
      ...(s.userId === me.id ? { viewers: s.viewers.map((v) => publicUser(user(v))).filter(Boolean) } : {}),
    });
    const by = (uid) => db.stories.filter((s) => s.userId === uid).sort((a, b) => a.createdAt - b.createdAt).map(shape);
    const friends = friendIds(me.id)
      .map((fid) => ({ user: publicUser(user(fid)), stories: by(fid) }))
      .filter((g) => g.stories.length)
      .sort((a, b) => Number(a.stories.every((s) => s.seen)) - Number(b.stories.every((s) => s.seen))
        || b.stories.at(-1).createdAt - a.stories.at(-1).createdAt);
    return { mine: by(me.id), friends };
  });

  route('GET', '/api/stories/:id/media', ({ me, params, res }) => {
    const s = db.stories.find((x) => x.id === params.id);
    if (!s || (s.userId !== me.id && !areFriends(me.id, s.userId))) fail(404, 'Story not found.');
    res.writeHead(200, {
      'Content-Type': s.media.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    });
    res.end(store.readMedia(s.media));
    return undefined;
  });

  route('POST', '/api/stories/:id/view', ({ me, params }) => {
    const s = db.stories.find((x) => x.id === params.id);
    if (!s || (s.userId !== me.id && !areFriends(me.id, s.userId))) fail(404, 'Story not found.');
    if (s.userId !== me.id && !s.viewers.includes(me.id)) {
      s.viewers.push(me.id);
      store.save();
      push(s.userId, { type: 'story-view' });
    }
    return { ok: true };
  });

  // ---------- dispatcher ----------
  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      serveStatic(req, res, url.pathname);
      return;
    }
    try {
      let match;
      const r = routes.find((x) => x.method === req.method && (match = x.re.exec(url.pathname)));
      if (!r) fail(404, 'Not found.');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const me = user(db.sessions[cookies(req).sid]);
      if (r.auth && !me) fail(401, 'Log in first.');
      const body = req.method === 'POST' ? await readBody(req) : {};
      const ip = req.socket.remoteAddress;
      const out = await r.handler({ req, res, url, params, body, me, ip });
      if (out !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
      }
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong.' : err.message }));
    }
  }

  expire();
  const timer = setInterval(expire, 60 * 1000);
  timer.unref();
  const server = http.createServer(handle);
  server.on('close', () => { clearInterval(timer); store.flush(); });
  return { server, store, expire };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp({ dataDir: process.env.DATA_DIR });
  server.listen(port, () => console.log(`Poof is running on http://localhost:${port}`));
}

module.exports = { createApp };
