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
- **Gestures:** one small pointer-events tracker in `app.js` (`pointerDrag`)
  decides after 10px whether a drag is sideways or vertical and only takes
  the axis it wants; CSS `touch-action: pan-y` leaves vertical scrolling to
  the browser. Tab swipes show the last drawn screen of the neighbour tab
  (kept when it was replaced, inert and hidden from assistive tech) and
  slide the real one in from there. The click after a drag or a hold is
  swallowed, so it is never also a tap.
- **Video snaps:** holding the shutter records with `MediaRecorder` (WebM
  VP8/Opus, else MP4), up to 10 seconds. The caption travels beside the
  video and is shown over it. Mute takes the sound track out of the WebM
  (`public/webm.js`, no re-encoding); for MP4 a second copy records without
  the microphone. Only one encoder runs for WebM: two VP8 encoders at
  1080x1920 starve each other on a computer and one comes out empty.

## Security

- Passwords hashed with scrypt + per-user salt, compared in constant time.
- Session: random 32-byte token in an `HttpOnly; SameSite=Lax` cookie.
- Every write is JSON-only (`Content-Type: application/json`), which with
  SameSite cookies blocks cross-site form posts.
- Request bodies capped at 6 MB, except `POST /api/snaps` at 16 MB (videos
  up to 11 MB, photos up to 5 MB). A body over its cap is read to the end
  and dropped, then answered with 413, so the client hears why (cutting it
  off mid-upload reset the connection); past twice the cap it is cut off.
- Images must be JPEG/PNG data URLs; videos WebM/MP4 data URLs, checked by
  their first bytes (the EBML magic, or an MP4 `ftyp` box) as well as the label.
- Snap media is never served by URL: `POST /api/snaps/:id/open` returns it
  once to the recipient and deletes the file in the same request.
- Story media is served only to the owner and their friends, with
  `nosniff` and byte ranges (video players ask for ranges; Safari requires them).
- Login and signup are rate limited per IP (30 tries per 15 minutes). The
  live username check has its own bucket with the same limit, so typing a
  username never uses up log in attempts.

## Data

```
users        { id, username, displayName, salt, hash, createdAt }
sessions     { token: userId }
friendships  { id, a, b, requester, status: pending|accepted, createdAt }
snaps        { id, from, to, media, duration, createdAt, openedAt }
             video snaps add { type: 'video', caption, mirror }; duration is their length
messages     { id, from, to, text, createdAt, readAt, saved }
stories      { id, userId, media, duration, createdAt, viewers[] } (+ type, caption, mirror for video)
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
GET  /api/users/available?username=     {available, reason}; no session needed
GET  /api/users/search?q=
GET  /api/users/by-username/:username  publicUser + status: self|friends|requested|incoming|none
GET  /api/friends                      friends, incoming, outgoing
POST /api/friends/request {username}
POST /api/friends/accept  {userId}
POST /api/friends/remove  {userId}
POST /api/snaps {to[], story, image, duration}               photo (duration: seconds shown, 0 = no limit)
POST /api/snaps {to[], story, video, caption, duration, mirror}  video (duration: its length, up to 10s)
POST /api/snaps/:id/open               {image, duration} or {video, caption, duration, mirror}; deleted
GET  /api/inbox
GET  /api/chat/:friendId
POST /api/chat/:friendId {text}
POST /api/messages/:id/save
GET  /api/stories
GET  /api/stories/:id/media            photo or video; Range requests answered with 206
POST /api/stories/:id/view
```

## Puffcodes and profile links

A Puffcode is a QR code (level H) of `<origin>/add/<username>`. Any path
that is not a file serves `index.html`, so `/add/<username>` opens the app,
which reads the username, remembers it in `sessionStorage` through log in
or sign up, and opens Add friend for that person. The encoder
(`public/qr.js`) and the art (`public/puffcode.js`) are plain browser
scripts that also load in Node for tests; `test/fixtures/qr-reference.json`
pins the encoder to the Python `qrcode` package bit for bit, and
`test/puffcode-scan.py` decodes rendered Puffcodes with OpenCV. Scanning in
the app uses the browser's `BarcodeDetector` where there is one; the server
never sees a camera frame.

## Build order

1. Server + store + auth (S01)
2. Friends (S09)
3. Camera → editor → send → inbox → viewer (S02–S06), the core loop
4. Chat (S07)
5. Stories + profile (S08, S10)
6. Realtime, streaks, polish
