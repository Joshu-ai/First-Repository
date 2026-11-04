'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');
const Avatar = require('./public/avatar');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MAX_BODY = 6 * 1024 * 1024; // any request body
const MAX_SNAP_BODY = 16 * 1024 * 1024; // POST /api/snaps only: room for a 10 second video
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_VIDEO = 11 * 1024 * 1024; // a 10 second clip at the app's bitrate is about 3 MB
const MAX_GROUP = 32; // people in a group, its creator included
const GROUP_NAME = 40; // characters in a group's name
const MAX_GROUPS = 100; // groups one person can be in at a time
const MAX_RECIPIENTS = 64; // friends plus groups one snap can go to
// what's stored for each kind of media, by file extension
const MEDIA_TYPES = { jpg: 'image/jpeg', png: 'image/png', webm: 'video/webm', mp4: 'video/mp4' };
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // every WebM file starts with this
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
  const streams = new Map(); // userId -> Map(res -> { sid, ping }): each live stream and the session that opened it
  const attempts = new Map(); // ip -> {count, reset}
  const typingAt = new Map(); // "from>to" -> when a typing event was last passed on

  // ---------- helpers ----------
  const user = (id) => db.users.find((u) => u.id === id);
  const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar || null };
  const pairKey = (a, b) => [a, b].sort().join('|');
  const friendship = (a, b) => db.friendships.find(
    (f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
  const areFriends = (a, b) => friendship(a, b)?.status === 'accepted';
  const friendIds = (id) => db.friendships
    .filter((f) => f.status === 'accepted' && (f.a === id || f.b === id))
    .map((f) => (f.a === id ? f.b : f.a));

  // A live stream lasts only as long as the session that opened it: one whose
  // session has ended (logged out) is closed instead of being written to.
  function endStream(userId, res) {
    const live = streams.get(userId)?.get(res);
    if (live) clearInterval(live.ping);
    streams.get(userId)?.delete(res);
    res.end();
  }
  function push(userId, event) {
    const set = streams.get(userId);
    if (!set) return;
    for (const [res, live] of set) {
      if (db.sessions[live.sid] !== userId) endStream(userId, res);
      else res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  // Snap, message and friends events say who they are from twice: `from`,
  // their id (as before), and `sender`, who they are (publicUser), so the
  // app can show a banner with their name and avatar without asking again.
  const fromMe = (me) => ({ from: me.id, sender: publicUser(me) });

  // A message's first PREVIEW characters for the banner, whole characters
  // only (never half an emoji), with an ellipsis when there is more.
  const PREVIEW = 60;
  function preview(text) {
    const chars = Array.from(text.replace(/\s+/g, ' ').trim());
    return chars.length > PREVIEW ? chars.slice(0, PREVIEW - 1).join('').trimEnd() + '\u2026' : chars.join('');
  }

  // ---------- groups ----------
  // A group is {id, name, members[], createdBy, createdAt}; its creator is a
  // member like any other once it exists. Its chat and snaps live beside the
  // one-to-one ones (groupMessages, groupSnaps), each keeping who has read or
  // opened it: readBy / openedBy, {userId: when}.
  const group = (id) => db.groups.find((g) => g.id === id);
  // A group given no name (name '') is called after the others in it, as each
  // member sees it and as it is now: "Ben and Cal" for Ava, "Ava and Cal" for Ben.
  function groupName(g, viewerId) {
    if (g.name) return g.name;
    const names = g.members.filter((id) => id !== viewerId).map((id) => user(id)?.displayName).filter(Boolean);
    if (!names.length) return 'Just you';
    const named = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
    return named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named.at(-1) : named[0];
  }
  const groupRef = (g, viewerId) => ({ id: g.id, name: groupName(g, viewerId) });
  const groupView = (g, viewerId) => ({
    id: g.id, name: groupName(g, viewerId), named: Boolean(g.name), createdBy: g.createdBy, createdAt: g.createdAt,
    members: g.members.map((id) => publicUser(user(id))).filter(Boolean),
  });
  // the group, if `me` is in it; anyone else is told there is no such group
  function memberGroup(id, me) {
    const g = group(id);
    if (!g || !g.members.includes(me.id)) fail(404, 'Group not found.');
    return g;
  }
  // `event` is the same for everyone, or made for each member (it names the group as they see it)
  function pushGroup(g, exceptId, event) {
    for (const id of g.members) if (id !== exceptId) push(id, typeof event === 'function' ? event(id) : event);
  }
  // When every member but `from` has an entry in `seen` (read or opened),
  // the time the last of them did, never before `since`; else null. Members
  // who left no longer count, and with no one else in the group it is `since`.
  function everyoneAt(g, from, seen, since) {
    let at = since;
    for (const id of g.members) {
      if (id === from) continue;
      if (!seen[id]) return null;
      at = Math.max(at, seen[id]);
    }
    return at;
  }
  // whole characters, spaces tidied; '' for none
  function cleanGroupName(value) {
    if (typeof value !== 'string') return '';
    return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, GROUP_NAME).join('').trim();
  }
  const groupCount = (userId) => db.groups.filter((g) => g.members.includes(userId)).length;

  // ---------- media ----------
  // One upload is stored once, however many snaps, group snaps and stories it
  // went to. A record lets go of its file (its media set to null) when it is
  // opened or expires, and the file is deleted once no record holds it.
  function release(rec) {
    const name = rec.media;
    rec.media = null;
    if (!name) return;
    const holds = (list) => list.some((x) => x.media === name);
    if (!holds(db.snaps) && !holds(db.groupSnaps) && !holds(db.stories)) store.deleteMedia(name);
  }
  // A group snap's media is deleted once every other member has opened it;
  // the group, its chat and its snaps go when the last member leaves.
  function settleGroupSnaps(g) {
    for (const s of db.groupSnaps) {
      if (s.group === g.id && s.media && everyoneAt(g, s.from, s.openedBy, s.createdAt) !== null) release(s);
    }
  }
  function dropGroup(g) {
    db.groups = db.groups.filter((x) => x !== g);
    db.groupMessages = db.groupMessages.filter((m) => m.group !== g.id);
    for (const s of db.groupSnaps) if (s.group === g.id) release(s);
    db.groupSnaps = db.groupSnaps.filter((s) => s.group !== g.id);
  }
  const groupMessage = (m) => ({
    id: m.id, from: m.from, text: m.text, createdAt: m.createdAt, saved: m.saved,
    readBy: Object.keys(m.readBy), ...(m.event ? { event: m.event } : {}),
  });

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
    if (buf.length > MAX_IMAGE) fail(413, 'Image is too large.');
    return { buf, ext: m[1] === 'jpeg' ? 'jpg' : 'png' };
  }

  // A video snap: a WebM or MP4 data URL (what browsers' MediaRecorder makes),
  // checked by its first bytes as well as its label.
  function parseVideo(dataUrl) {
    const m = /^data:video\/(webm|mp4)(?:;[\w.+-]+=[\w.+-]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
    if (!m) fail(400, 'Video must be a WebM or MP4.');
    if (Math.floor(m[2].length / 4) * 3 > MAX_VIDEO + 3) fail(413, 'Video is too large.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_VIDEO) fail(413, 'Video is too large.');
    const real = m[1] === 'webm' ? buf.subarray(0, 4).equals(EBML) : buf.subarray(4, 8).toString('latin1') === 'ftyp';
    if (!real) fail(400, 'Video must be a WebM or MP4.');
    return { buf, ext: m[1] };
  }

  // a video's caption travels beside it (a photo's is drawn into the picture)
  const cleanCaption = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '');

  function expire() {
    const t = now();
    let changed = false;
    db.snaps = db.snaps.filter((s) => {
      const keep = !s.openedAt && t - s.createdAt < 30 * DAY;
      const keepRecord = keep || (s.openedAt && t - s.openedAt < 30 * DAY);
      if (!keep && s.media) { release(s); changed = true; }
      if (!keepRecord) changed = true;
      return keepRecord;
    });
    const count = () => db.messages.length + db.stories.length + db.groupMessages.length + db.groupSnaps.length;
    const before = count();
    db.messages = db.messages.filter((m) => m.saved || !m.readAt || t - m.readAt < DAY);
    db.stories = db.stories.filter((s) => {
      if (t - s.createdAt < DAY) return true;
      release(s);
      return false;
    });
    // group chats: gone 24 hours after every other member has read them, unless kept
    const groups = new Map(db.groups.map((g) => [g.id, g]));
    db.groupMessages = db.groupMessages.filter((m) => {
      const g = groups.get(m.group);
      if (!g) return false;
      if (m.saved) return true;
      const readAt = everyoneAt(g, m.from, m.readBy, m.createdAt);
      return readAt === null || t - readAt < DAY;
    });
    // group snaps: the media goes once everyone has opened it (or after 30
    // days unopened), the record 30 days after that, as for one-to-one snaps
    db.groupSnaps = db.groupSnaps.filter((s) => {
      const g = groups.get(s.group);
      if (!g) { release(s); return false; }
      const openedAt = everyoneAt(g, s.from, s.openedBy, s.createdAt);
      const keep = openedAt === null && t - s.createdAt < 30 * DAY;
      if (!keep && s.media) { release(s); changed = true; }
      return keep || (openedAt !== null && t - openedAt < 30 * DAY);
    });
    if (changed || before !== count()) store.save();
  }

  // 30 tries per IP (or person) per 15 minutes, counted per bucket so that
  // checking usernames while typing never uses up someone's log in attempts
  function rateLimit(ip, bucket = 'auth', message = 'Too many attempts. Try again in a few minutes.') {
    const t = now();
    const key = bucket + ' ' + ip;
    const a = attempts.get(key);
    if (!a || a.reset < t) return attempts.set(key, { count: 1, reset: t + 15 * 60 * 1000 });
    if (++a.count > 30) fail(429, message);
  }

  // one rule for sign up and the live availability check: [status, reason] or null
  const cleanUsername = (value) => String(value || '').trim().toLowerCase();
  function usernameProblem(username) {
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) return [400, 'Usernames are 3-20 letters, numbers, dots or underscores.'];
    if (db.users.some((u) => u.username === username)) return [409, 'That username is taken.'];
    return null;
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

  // A body over the limit is read to the end and dropped, then answered with
  // 413, so the client gets the answer (cutting it off mid-upload resets the
  // connection and the client sees only a network error). Past twice the
  // limit the connection is cut anyway.
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json/.test(req.headers['content-type'] || '')) {
        return reject(new HttpError(415, 'Send JSON.'));
      }
      let size = 0;
      let chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit * 2) { reject(new HttpError(413, 'Too large.')); req.destroy(); return; }
        if (size > limit) { chunks = null; return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks) return reject(new HttpError(413, 'Too large.'));
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { return reject(new HttpError(400, 'Bad JSON.')); }
        resolve(value && typeof value === 'object' ? value : {}); // `null` or a bare number is no fields at all
        return undefined;
      });
      req.on('error', reject);
    });
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler, auth: opts.auth !== false, maxBody: opts.maxBody || MAX_BODY });
  };

  route('POST', '/api/signup', ({ body, res, ip }) => {
    rateLimit(ip);
    const username = cleanUsername(body.username);
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 40) || username;
    const problem = usernameProblem(username);
    if (problem) fail(...problem);
    if (password.length < 8) fail(400, 'Passwords need at least 8 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    const u = { id: store.id(), username, displayName, salt, hash: hashPassword(password, salt), createdAt: now() };
    db.users.push(u);
    startSession(res, u.id);
    return publicUser(u);
  }, { auth: false });

  // live check for the sign up form; the same rule as sign up, never a session
  route('GET', '/api/users/available', ({ url, ip }) => {
    rateLimit(ip, 'available');
    const problem = usernameProblem(cleanUsername(url.searchParams.get('username')));
    return { available: !problem, reason: problem ? problem[1] : null };
  }, { auth: false });

  route('POST', '/api/login', ({ body, res, ip }) => {
    rateLimit(ip);
    const u = db.users.find((x) => x.username === cleanUsername(body.username));
    const given = Buffer.from(hashPassword(String(body.password || ''), u ? u.salt : 'x'), 'hex');
    if (!u || !crypto.timingSafeEqual(given, Buffer.from(u.hash, 'hex'))) {
      fail(401, 'Wrong username or password.');
    }
    startSession(res, u.id);
    return publicUser(u);
  }, { auth: false });

  // Logging out ends the session and every live stream it opened (another
  // tab's, say), so nothing more reaches a browser that is logged out.
  route('POST', '/api/logout', ({ req, res }) => {
    const sid = cookies(req).sid;
    delete db.sessions[sid];
    for (const [userId, set] of streams) {
      for (const [stream, live] of set) if (live.sid === sid) endStream(userId, stream);
    }
    store.save();
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });

  route('GET', '/api/me', ({ me }) => publicUser(me));

  // Who is logged in on this browser, or null: what the app asks first, so
  // opening it logged out is an answer rather than an error.
  route('GET', '/api/session', ({ me }) => ({ user: me ? publicUser(me) : null }), { auth: false });

  route('POST', '/api/me/avatar', ({ me, body }) => {
    const avatar = Avatar.normalize(body.avatar);
    if (!avatar) fail(400, 'That avatar has a part that does not exist.');
    me.avatar = avatar;
    store.save();
    for (const id of friendIds(me.id)) push(id, { type: 'friends', kind: 'avatar', ...fromMe(me) });
    return publicUser(me);
  });

  // The live stream, filed under the session that opened it. Without a
  // session it answers 204, which tells the browser to stop reconnecting.
  route('GET', '/api/events', ({ me, req, res }) => {
    if (!me) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return undefined; }
    const sid = cookies(req).sid;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    if (!streams.has(me.id)) streams.set(me.id, new Map());
    const live = { sid, ping: null };
    streams.get(me.id).set(res, live);
    live.ping = setInterval(() => {
      if (db.sessions[sid] !== me.id) endStream(me.id, res);
      else res.write(': ping\n\n');
    }, 25000);
    res.on('close', () => { clearInterval(live.ping); streams.get(me.id)?.delete(res); });
    return undefined; // stream stays open
  }, { auth: false });

  route('GET', '/api/users/search', ({ me, url }) => {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return db.users
      .filter((u) => u.id !== me.id && (u.username.includes(q) || u.displayName.toLowerCase().includes(q)))
      .slice(0, 20)
      .map((u) => ({ ...publicUser(u), status: friendship(me.id, u.id)?.status || null }));
  });

  // one person by username, for Puffcodes and /add/<username> links, with
  // where the two of you stand: self, friends, requested (you asked them),
  // incoming (they asked you) or none
  // (missing: there is nobody by that name, which a link or code can say)
  route('GET', '/api/users/by-username/:username', ({ me, params }) => {
    const u = db.users.find((x) => x.username === cleanUsername(params.username));
    if (!u) return { status: 'missing' };
    if (u.id === me.id) return { ...publicUser(u), status: 'self' };
    const f = friendship(me.id, u.id);
    const status = !f ? 'none' : f.status === 'accepted' ? 'friends' : f.requester === me.id ? 'requested' : 'incoming';
    return { ...publicUser(u), status };
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
        push(target.id, { type: 'friends', kind: 'accepted', ...fromMe(me) });
      }
      return { status: existing.status };
    }
    db.friendships.push({ id: store.id(), a: me.id, b: target.id, requester: me.id, status: 'pending', createdAt: now() });
    store.save();
    push(target.id, { type: 'friends', kind: 'request', ...fromMe(me) });
    return { status: 'pending' };
  });

  route('POST', '/api/friends/accept', ({ me, body }) => {
    const f = friendship(me.id, body.userId);
    if (!f || f.status !== 'pending' || f.requester === me.id) fail(404, 'No request to accept.');
    f.status = 'accepted';
    store.save();
    push(body.userId, { type: 'friends', kind: 'accepted', ...fromMe(me) });
    return { status: 'accepted' };
  });

  route('POST', '/api/friends/remove', ({ me, body }) => {
    const f = friendship(me.id, body.userId);
    if (!f) fail(404, 'Not friends.');
    db.friendships = db.friendships.filter((x) => x !== f);
    store.save();
    push(body.userId, { type: 'friends', kind: 'removed', ...fromMe(me) });
    return { ok: true };
  });

  // A snap is a photo {image, duration: seconds shown, 0 = no limit} or a
  // video {video, caption, duration: its length in seconds, mirror: recorded
  // on a front camera}, to friends (`to`), groups you are in (`groupIds`)
  // and/or your story: up to MAX_RECIPIENTS friends and groups, the file
  // stored once for all of them. The only route that takes a body over 6 MB.
  route('POST', '/api/snaps', ({ me, body }) => {
    const to = Array.isArray(body.to) ? [...new Set(body.to)] : [];
    const groupIds = Array.isArray(body.groupIds) ? [...new Set(body.groupIds)] : [];
    const story = body.story === true;
    if (!to.length && !groupIds.length && !story) fail(400, 'Pick at least one friend, group or your story.');
    if (to.length + groupIds.length > MAX_RECIPIENTS) fail(400, `You can send a poof to up to ${MAX_RECIPIENTS} friends and groups at once.`);
    if (to.some((id) => !areFriends(me.id, id))) fail(403, 'You can only send poofs to friends.');
    const groups = groupIds.map((id) => memberGroup(id, me));
    const isVideo = body.video != null;
    let duration;
    let extra = {};
    if (isVideo) {
      const secs = Number(body.duration);
      duration = Number.isFinite(secs) && secs > 0 ? Math.min(10, Math.max(0.1, Math.round(secs * 10) / 10)) : 10;
      extra = { type: 'video', caption: cleanCaption(body.caption), mirror: body.mirror === true };
    } else {
      duration = body.duration === 0 ? 0 : Math.min(10, Math.max(1, Math.round(Number(body.duration) || 5)));
    }
    const { buf, ext } = isVideo ? parseVideo(body.video) : parseImage(body.image);
    const media = store.putMedia(buf, ext); // one file, held by every record below
    for (const id of to) {
      db.snaps.push({ id: store.id(), from: me.id, to: id, media, duration, ...extra, createdAt: now(), openedAt: null });
      recordStreak(me.id, id);
      push(id, { type: 'snap', ...fromMe(me) });
    }
    // one record per group, shared by its members: each opens it once
    for (const g of groups) {
      db.groupSnaps.push({ id: store.id(), group: g.id, from: me.id, media, duration, ...extra, createdAt: now(), openedBy: {} });
      pushGroup(g, me.id, (id) => ({ type: 'snap', ...fromMe(me), group: groupRef(g, id) }));
    }
    if (story) {
      db.stories.push({ id: store.id(), userId: me.id, media, duration: duration || 5, ...extra, createdAt: now(), viewers: [] });
      for (const id of friendIds(me.id)) push(id, { type: 'story', from: me.id });
    }
    store.save();
    return { sent: to.length, groups: groups.length, story };
  }, { maxBody: MAX_SNAP_BODY });

  const mediaUrl = (name) => `data:${MEDIA_TYPES[path.extname(name).slice(1)]};base64,` + store.readMedia(name).toString('base64');
  const snapShape = (s, dataUrl) => (s.type === 'video'
    ? { video: dataUrl, caption: s.caption || '', duration: s.duration, mirror: !!s.mirror }
    : { image: dataUrl, duration: s.duration });

  // A one-to-one snap opens once for the friend it was sent to, a group snap
  // once for each member but its sender (who it is from comes with it).
  route('POST', '/api/snaps/:id/open', ({ me, params }) => {
    const s = db.snaps.find((x) => x.id === params.id && x.to === me.id);
    if (!s) return openGroupSnap(me, params.id);
    if (s.openedAt || !s.media) fail(410, 'This poof has already been opened.');
    const dataUrl = mediaUrl(s.media);
    release(s);
    s.openedAt = now();
    store.save();
    push(s.from, { type: 'opened', by: me.id });
    return snapShape(s, dataUrl);
  });

  function openGroupSnap(me, id) {
    const s = db.groupSnaps.find((x) => x.id === id);
    const g = s && group(s.group);
    if (!g || !g.members.includes(me.id) || s.from === me.id) fail(404, 'Poof not found.');
    if (s.openedBy[me.id] || !s.media) fail(410, 'This poof has already been opened.');
    const dataUrl = mediaUrl(s.media);
    s.openedBy[me.id] = now();
    settleGroupSnaps(g);
    store.save();
    if (g.members.includes(s.from)) push(s.from, { type: 'opened', by: me.id, group: g.id });
    return { ...snapShape(s, dataUrl), sender: publicUser(user(s.from)), group: groupRef(g, me.id) };
  }

  // Each group you are in has a row like a friend's: {group, status, snapIds,
  // unread, lastAt}. Your snap or chat there is Opened or Read once everyone
  // else has; members leaving are shown in the chat but not here.
  function groupRow(g, me) {
    const snaps = db.groupSnaps.filter((s) => s.group === g.id);
    const msgs = db.groupMessages.filter((m) => m.group === g.id && !m.event);
    const newSnaps = snaps.filter((s) => s.from !== me.id && s.media && !s.openedBy[me.id]);
    const unread = msgs.filter((m) => m.from !== me.id && !m.readBy[me.id]).length;
    const last = [...snaps, ...msgs].sort((a, b) => b.createdAt - a.createdAt)[0];
    let status = 'tap-to-chat';
    if (newSnaps.length) status = 'new-snap';
    else if (unread) status = 'new-chat';
    else if (last && 'media' in last) {
      status = last.from === me.id ? (everyoneAt(g, last.from, last.openedBy, 0) !== null ? 'opened' : 'delivered') : 'received';
    } else if (last) {
      status = last.from === me.id ? (everyoneAt(g, last.from, last.readBy, 0) !== null ? 'chat-opened' : 'chat-delivered') : 'chat-received';
    }
    return {
      group: groupView(g, me.id),
      status,
      snapIds: newSnaps.sort((a, b) => a.createdAt - b.createdAt).map((s) => s.id),
      unread,
      lastAt: last ? last.createdAt : g.createdAt,
    };
  }

  route('GET', '/api/inbox', ({ me }) => {
    const groups = db.groups.filter((g) => g.members.includes(me.id)).map((g) => groupRow(g, me));
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
    }).concat(groups).sort((a, b) => b.lastAt - a.lastAt);
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
    typingAt.delete(me.id + '>' + fid); // a message ends the typing; the next keystroke starts it afresh
    push(fid, { type: 'message', ...fromMe(me), preview: preview(text) });
    return m;
  });

  // Someone is typing to a friend: passed straight on over the friend's live
  // stream as {type: 'typing', from}, never stored. The app sends it at most
  // every 2 seconds while typing and the friend shows it for 4; a client
  // that sends more often is answered but not passed on more than once a
  // second (until it sends a message, which starts the count again).
  route('POST', '/api/chat/:friendId/typing', ({ me, params }) => {
    const fid = params.friendId;
    if (!areFriends(me.id, fid)) fail(403, 'Not friends.');
    const key = me.id + '>' + fid;
    const t = now();
    const last = typingAt.get(key);
    if (last === undefined || t - last >= 1000) {
      typingAt.set(key, t);
      push(fid, { type: 'typing', from: me.id });
    }
    return { ok: true };
  });

  // Keep a message (or stop keeping it): in a group, for everyone in it.
  route('POST', '/api/messages/:id/save', ({ me, params }) => {
    const m = db.messages.find((x) => x.id === params.id && (x.from === me.id || x.to === me.id));
    if (!m) {
      const gm = db.groupMessages.find((x) => x.id === params.id && !x.event);
      const g = gm && group(gm.group);
      if (!g || !g.members.includes(me.id)) fail(404, 'Message not found.');
      gm.saved = !gm.saved;
      store.save();
      pushGroup(g, me.id, { type: 'read', by: me.id, group: g.id });
      return { saved: gm.saved };
    }
    m.saved = !m.saved;
    store.save();
    push(m.from === me.id ? m.to : m.from, { type: 'read', by: me.id });
    return { saved: m.saved };
  });

  // ---------- group chats ----------
  // {name, members[]}: friends of yours, up to MAX_GROUP people with you.
  // A blank name stays blank: each member sees it named for the others in it.
  // Nobody is in more than MAX_GROUPS, and one person can try to start 30
  // in 15 minutes.
  route('POST', '/api/groups', ({ me, body }) => {
    rateLimit(me.id, 'groups', "You've started a lot of groups. Try again in a few minutes.");
    const ids = Array.isArray(body.members) ? [...new Set(body.members)].filter((id) => id !== me.id) : [];
    if (!ids.length) fail(400, 'Pick at least one friend.');
    if (ids.length + 1 > MAX_GROUP) fail(400, `Groups can have up to ${MAX_GROUP} people.`);
    if (ids.some((id) => !areFriends(me.id, id))) fail(403, 'You can only add friends to a group.');
    if (groupCount(me.id) >= MAX_GROUPS) fail(400, `You're in ${MAX_GROUPS} groups, the most there can be. Leave one to start another.`);
    const full = ids.find((id) => groupCount(id) >= MAX_GROUPS);
    if (full) fail(400, `${user(full).displayName} is in too many groups to be added to another.`);
    const members = [me.id, ...ids];
    const g = { id: store.id(), name: cleanGroupName(body.name), members, createdBy: me.id, createdAt: now() };
    db.groups.push(g);
    store.save();
    pushGroup(g, me.id, (id) => ({ type: 'group', kind: 'added', group: groupRef(g, id), ...fromMe(me) }));
    return groupView(g, me.id);
  });

  route('GET', '/api/groups', ({ me }) => db.groups
    .filter((g) => g.members.includes(me.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((g) => groupView(g, me.id)));

  // Leaving says so in the chat and to everyone still in it. The last one
  // out takes the group with them: its chat, its snaps and their files.
  route('POST', '/api/groups/:id/leave', ({ me, params }) => {
    const g = memberGroup(params.id, me);
    g.members = g.members.filter((id) => id !== me.id);
    if (!g.members.length) dropGroup(g);
    else {
      db.groupMessages.push({ id: store.id(), group: g.id, from: me.id, event: 'left', text: '', createdAt: now(), readBy: {}, saved: false });
      settleGroupSnaps(g); // a snap waiting only on them is done with
      pushGroup(g, me.id, (id) => ({ type: 'group', kind: 'left', group: groupRef(g, id), ...fromMe(me) }));
    }
    store.save();
    return { ok: true };
  });

  // Reading the chat marks it read for you. `people` is everyone the chat
  // mentions (members, and anyone who has left since they wrote).
  route('GET', '/api/groups/:id/chat', ({ me, params }) => {
    const g = memberGroup(params.id, me);
    const list = db.groupMessages.filter((m) => m.group === g.id).sort((a, b) => a.createdAt - b.createdAt);
    let changed = false;
    for (const m of list) {
      if (m.from !== me.id && !m.readBy[me.id]) { m.readBy[me.id] = now(); changed = true; }
    }
    if (changed) { store.save(); pushGroup(g, me.id, { type: 'read', by: me.id, group: g.id }); }
    const people = [...new Set([...g.members, ...list.map((m) => m.from)])].map((id) => publicUser(user(id))).filter(Boolean);
    return { group: groupView(g, me.id), people, messages: list.map(groupMessage) };
  });

  route('POST', '/api/groups/:id/chat', ({ me, params, body }) => {
    const g = memberGroup(params.id, me);
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) fail(400, 'Say something.');
    const m = { id: store.id(), group: g.id, from: me.id, text, createdAt: now(), readBy: {}, saved: false };
    db.groupMessages.push(m);
    store.save();
    pushGroup(g, me.id, (id) => ({ type: 'message', ...fromMe(me), preview: preview(text), group: groupRef(g, id) }));
    return groupMessage(m);
  });

  route('GET', '/api/stories', ({ me }) => {
    const shape = (s) => ({
      id: s.id, createdAt: s.createdAt, duration: s.duration, type: s.type || 'photo',
      ...(s.type === 'video' ? { caption: s.caption || '', mirror: !!s.mirror } : {}),
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

  // Photos and videos, with byte ranges: video players ask for ranges, and
  // Safari won't play a video from a server that can't answer them.
  route('GET', '/api/stories/:id/media', ({ me, params, req, res }) => {
    const s = db.stories.find((x) => x.id === params.id);
    if (!s || (s.userId !== me.id && !areFriends(me.id, s.userId))) fail(404, 'Story not found.');
    const data = store.readMedia(s.media);
    const head = {
      'Content-Type': MEDIA_TYPES[path.extname(s.media).slice(1)] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const last = data.length - 1;
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), last) : last;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        res.end();
        return undefined;
      }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
      res.end(data.subarray(start, end + 1));
      return undefined;
    }
    res.writeHead(200, { ...head, 'Content-Length': data.length });
    res.end(data);
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
      let params;
      try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])])); }
      catch { fail(400, 'Bad address.'); }
      const me = user(db.sessions[cookies(req).sid]);
      if (r.auth && !me) fail(401, 'Log in first.');
      const body = req.method === 'POST' ? await readBody(req, r.maxBody) : {};
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

module.exports = {
  createApp,
  LIMITS: { body: MAX_BODY, snapBody: MAX_SNAP_BODY, image: MAX_IMAGE, video: MAX_VIDEO, recipients: MAX_RECIPIENTS, groups: MAX_GROUPS },
};
