# Architecture: Poof

## Stack

- **Server:** Node.js 18+ with no dependencies (`node:http`, `node:crypto`).
  Runs anywhere with `node server.js`, nothing to install.
- **Storage:** a JSON file (`data/db.json`) plus one file per photo in
  `data/media/`. Fine for a demo or a few hundred users; swap `store.js` for
  Postgres before real launch (all reads and writes go through it).
- **Realtime:** Server-Sent Events (`/api/events`), one stream per logged-in tab.
- **Client:** plain HTML/CSS/JS, mobile-first, installable (web manifest).
  Camera via `getUserMedia`, editing on a `<canvas>`; caption and drawing are
  burned into the JPEG before upload.

## Security

- Passwords hashed with scrypt + per-user salt, compared in constant time.
- Session: random 32-byte token in an `HttpOnly; SameSite=Lax` cookie.
- Every write is JSON-only (`Content-Type: application/json`), which with
  SameSite cookies blocks cross-site form posts.
- Request bodies capped at 6 MB; images must be JPEG/PNG data URLs.
- Snap media is never served by URL: `POST /api/snaps/:id/open` returns it
  once to the recipient and deletes the file in the same request.
- Story media is served only to the owner and their friends.
- Login and signup are rate limited per IP.

## Data

```
users        { id, username, displayName, salt, hash, createdAt }
sessions     { token: userId }
friendships  { id, a, b, requester, status: pending|accepted, createdAt }
snaps        { id, from, to, media, duration, createdAt, openedAt }
messages     { id, from, to, text, createdAt, readAt, saved }
stories      { id, userId, media, duration, createdAt, viewers[] }
streaks      { "a|b": { days: {a: 'YYYY-MM-DD', b: ...}, count, lastDay } }
```

Expiry runs every minute and on boot: unopened snaps after 30 days, read
unsaved messages 24h after reading, stories 24h after posting.

## Streak rule

A day counts when both friends sent each other a snap that day (UTC). The
count goes up by one for each consecutive counted day and resets if a day is
missed. Shown in the inbox from 2 days on.

## API

```
POST /api/signup {username, password, displayName}
POST /api/login  {username, password}
POST /api/logout
GET  /api/me
GET  /api/events                       SSE
GET  /api/users/search?q=
GET  /api/friends                      friends, incoming, outgoing
POST /api/friends/request {username}
POST /api/friends/accept  {userId}
POST /api/friends/remove  {userId}
POST /api/snaps {to[], image, duration, story}
POST /api/snaps/:id/open
GET  /api/inbox
GET  /api/chat/:friendId
POST /api/chat/:friendId {text}
POST /api/messages/:id/save
GET  /api/stories
GET  /api/stories/:id/media
POST /api/stories/:id/view
```

## Build order

1. Server + store + auth (S01)
2. Friends (S09)
3. Camera → editor → send → inbox → viewer (S02–S06), the core loop
4. Chat (S07)
5. Stories + profile (S08, S10)
6. Realtime, streaks, polish
