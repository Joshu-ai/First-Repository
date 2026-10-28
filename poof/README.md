# Poof

Photos that vanish once they are seen. A camera-first messaging web app:
snap a photo, add a caption or a drawing, send it to friends, and it is gone
after they open it. Plus disappearing chat, 24-hour stories and streaks.

Built clean-room with the [replica](https://github.com/Jakeschincariol/replica-skill)
method; the planning files are in [`replica/`](replica/).

## Meet Puff

Puff is the Poof mascot: a flat, bold cloud drifting off in a trail of
little puffs, the way a snap goes "poof". It reads as a mark at 16px (the
app icon is the solid version) and has 10 expressions for the app. Drawn in
code (`public/mascot.js`), so it stays sharp from icon to poster. Puff greets you on the login
screen, naps on empty screens, and pops up with a "Poof!" when you send a
snap or one disappears.

## Avatars

Right after sign-up, people build an avatar, or tap 🎲 to shuffle one:

- **16 expressions:** smile, grin, laugh, wink, love, wow, sad, angry, cool,
  sleepy, silly, shy, nervous, crying laughing, thinking, starstruck
- face shape, 7 skin tones, 6 eye colours
- 11 hairstyles (crop, side part, afro, long, bun, bob, quiff, buzz,
  braids, puffs, bald) in 11 colours
- facial hair, extras (glasses, shades, cap, beanie, headphones, earrings,
  freckles), top and background

Avatars show everywhere a person appears and can be edited from the
profile. Drawn in code (`public/avatar.js`); the server stores only small
numbers and rejects anything that isn't a real option.

Puff has 10 moods too (happy, wink, sleepy, wow, love, laugh, sad, cool,
shy, party), used around the app: party when you post a story, love when
you make a friend, sad when a snap is already gone.

## Marketing art

`brand/` holds a social banner (1200×630), a story/phone poster
(1080×1920) and a large Puff (1024×1024), all rendered at 2× pixel
density. `brand/puff/` has Puff on its own in every mood plus the solid
mark, each as a vector SVG (sharp at any size) and a 2048px transparent
PNG. Everything is drawn from the same code as the app, so it always
matches. Change the cast or the tagline
in `brand/render.js`, then run `node brand/render.js` to redraw them.

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
