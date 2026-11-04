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

Right after sign-up, people build an avatar, or tap the die to shuffle one:

- **16 expressions:** smile, grin, laugh, wink, love, wow, sad, angry, cool,
  sleepy, silly, shy, nervous, crying laughing, thinking, starstruck
- face shape, 7 skin tones, 6 eye colours
- 11 hairstyles (crop, side part, afro, long, bun, bob, quiff, buzz,
  braids, puffs, bald) in 11 colours
- facial hair, extras (glasses, shades, cap, beanie, headphones, earrings,
  freckles), top and background

Avatars show everywhere a person appears and can be edited from the
profile. Drawn in code (`public/avatar.js`); the server stores only small
numbers and rejects anything that isn't a real option. Until someone makes
one, they show the white Puff mark on a circle in their own colour (a steady
hue from their username, darkened just enough to keep 3:1 contrast).

Puff has 10 moods too (happy, wink, sleepy, wow, love, laugh, sad, cool,
shy, party), used around the app: party when you post a story, love when
you make a friend, sad when a snap is already gone.

## Puffcode

Your profile code, large at the top of your profile: white dots on a
brand-violet tile, with your avatar inside a white Puff (Puff's own face
until you make one). It is a real QR code of `<your Poof address>/add/<username>`,
made by Poof's own encoder (`public/qr.js`: byte mode, error correction
level H, the smallest version that fits, all 8 masks scored with the
standard penalty rules). Puff sits in a knock-out sized from the code's own
layout (`public/puffcode.js`): it never covers a finder, timing or format
module, and it uses at most two thirds of what level H can repair in any
block, leaving the rest for glare and blur.

- **Share profile** opens the share sheet, or copies your link where there
  is none. **Save Puffcode** downloads it as a PNG.
- Opening `/add/<username>`, which is what a phone's camera app does with a
  Puffcode, opens Add friend for that person. Logged out, Poof remembers it
  through log in or sign up.
- **Add friends > Scan Puffcode** reads a code with the camera or from a
  photo, in browsers with a built-in code reader (`BarcodeDetector`: Chrome
  on Android, macOS and ChromeOS). Elsewhere it says to use the phone's
  camera app instead. Where there is a reader, the main camera also spots
  Puffcodes and offers "Add @name".
- White on violet is a light-on-dark QR code, which the QR standard allows
  and phone camera apps read. For readers that only read dark on light, the
  app also tries each frame with its colours flipped.

`npm run test:scan` proves they scan: it renders 48 Puffcodes in Chromium
and decodes 168 images of them (saved PNGs on light and dark backgrounds,
shrunk, blurred and tilted, plus the on-screen art) with OpenCV's
`QRCodeDetector`, and with `zxing-cpp` too when it is installed.

## Icons

Every control uses Poof's own drawn icons (`public/icons.js`): one 24px
grid, a 2px round stroke, coloured by the button they sit in. No emoji or
text symbols stand in for icons. Add friends is Puff's solid silhouette
with a plus badge. `PoofIcons.svg(name, size)` returns the markup; the
icons are decorative, so the button always carries the label.

## Marketing art

`brand/` holds a social banner (1200×630), a story/phone poster
(1080×1920) and a large Puff (1024×1024), all rendered at 2× pixel
density. `brand/puff/` has Puff on its own in every mood plus the solid
mark, each as a vector SVG (sharp at any size) and a 2048px transparent
PNG. Everything is drawn from the same code as the app, so it always
matches. The banner and poster use the **realistic Puff**
(`brand/puff/real/`, a sunlit cloud in all ten moods; see
[`brand/realistic/`](brand/realistic/) for how it is made). The app keeps
the flat vector Puff. Change the cast or the tagline
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
| Camera | Opens straight to the camera. Flip or double-tap to switch cameras, tap to focus, Flash (the back camera's light where the browser allows it, a white screen on the front camera), or pick a photo |
| Editor | Caption (drag it up or down), drawing in 7 colours with undo, timer 1/3/5/10s or no limit, save to device |
| Snaps | Send to several friends and/or your story. Each snap opens once, then the file is deleted on the server |
| Chat | Inbox with New / Opened / Delivered status. Chats delete 24h after they are read; tap one to keep it |
| Stories | Post for 24 hours, tap through friends' stories, see who watched yours |
| Friends | Search by username, requests, accept, remove, streaks for consecutive days |
| Puffcode | Your scannable profile code with your avatar inside; share or save it; scan friends' codes; `/add/<username>` links |
| Live | New snaps, chats and "opened" updates arrive instantly (Server-Sent Events) |

Not built: video snaps, group chats, AR lenses, map, discover feed, screenshot
alerts. See [`replica/parity.md`](replica/parity.md).

## Tests

```bash
npm test             # API: auth, friends, open-once snaps, chat expiry, stories, streaks, security
npm run test:e2e     # real browsers through every flow (needs Playwright + Chromium)
npm run test:scan    # Puffcodes decode with OpenCV (needs Python with opencv-python-headless, see below)
```

The scan check needs OpenCV for Python, for example in a virtual env:

```bash
python3 -m venv /tmp/qrcheck && /tmp/qrcheck/bin/pip install opencv-python-headless
/tmp/qrcheck/bin/python test/puffcode-scan.py
```

## Before a real launch

- Swap the JSON file store (`store.js`) for Postgres and the media folder for
  object storage. The current store is fine for a demo, not for many users.
- Put it behind HTTPS.
- Run a trademark check on the name "Poof" before using it publicly.
- Add reporting/blocking and an age gate: a messaging app for real users needs them.
