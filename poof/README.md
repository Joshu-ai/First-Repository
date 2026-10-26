# Poof

Photos that vanish once they are seen. A camera-first messaging web app:
snap a photo, add a caption or a drawing, send it to friends, and it is gone
after they open it. Plus disappearing chat, 24-hour stories and streaks.

Built clean-room with the [replica](https://github.com/Jakeschincariol/replica-skill)
method; the planning files are in [`replica/`](replica/).

## Meet Puff

Puff is the Poof mascot: a little cloud that vanishes, the way your snaps
do. Drawn in code (`public/mascot.js`) in four moods (happy, wink, sleepy,
wow). Puff is the app icon, greets you on the login screen, naps on empty
screens, and pops up with a "Poof!" when you send a snap or one disappears.

## Run it

Needs Node 18 or newer. Nothing to install.

```bash
cd poof
npm start            # http://localhost:3000
```

Open it in two browsers (or a normal and a private window), sign up two
users, add each other and snap away. On a phone, use your computer's local IP
over HTTPS (browsers only open the camera on `https://` or `localhost`), or
pick a photo from the gallery instead.

`PORT` and `DATA_DIR` environment variables change the port and where data is
stored (default `./data`).

## What it does

| | |
| --- | --- |
| Camera | Opens straight to the camera, front/back flip, or pick a photo |
| Editor | Caption (drag it up or down), drawing in 7 colours with undo, timer 1/3/5/10s or no limit, save to device |
| Snaps | Send to several friends and/or your story. Each snap opens once, then the file is deleted on the server |
| Chat | Inbox with New / Opened / Delivered status. Chats delete 24h after they are read; tap one to keep it |
| Stories | Post for 24 hours, tap through friends' stories, see who watched yours |
| Friends | Search by username, requests, accept, remove, streaks for consecutive days |
| Live | New snaps, chats and "opened" updates arrive instantly (Server-Sent Events) |

Not built: video snaps, group chats, AR lenses, map, discover feed, screenshot
alerts. See [`replica/parity.md`](replica/parity.md).

## Tests

```bash
npm test             # API: auth, friends, open-once snaps, chat expiry, stories, streaks, security
npm run test:e2e     # two real browsers through every flow (needs Playwright + Chromium)
```

## Before a real launch

- Swap the JSON file store (`store.js`) for Postgres and the media folder for
  object storage. The current store is fine for a demo, not for many users.
- Put it behind HTTPS.
- Run a trademark check on the name "Poof" before using it publicly.
- Add reporting/blocking and an age gate: a messaging app for real users needs them.
