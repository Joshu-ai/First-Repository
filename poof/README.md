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

The app icons for home screens, install prompts and notifications are PNGs
in `public/icons/`, rendered from `public/icon.svg` by `npm run icons`
(Playwright): 192 and 512px rounded tiles, a 512px maskable one with Puff
inside the safe zone, and a 180px apple-touch-icon that is violet to the
edges (iOS rounds it itself).

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
| Gestures | Swipe sideways between Chat, Camera and Stories (the screen follows your finger, the tab bar stays put). Tap a snap for the next, swipe it down to close. In a story, tap the right half for the next, the left half to go back, press and hold to pause, swipe down to close. Swipe a chat row right to open the chat; press and hold it (or tap the avatar) for the friend card. Pull down on the Chat or Stories list to refresh it, Puff showing above it. Escape closes viewers and sheets |
| Camera | Opens straight to the camera. Flip or double-tap to switch cameras, tap to focus, Flash (the back camera's light where the browser allows it, a white screen on the front camera), or pick a photo |
| Editor | Caption (drag it up or down), drawing in 7 colours with undo, timer 1/3/5/10s or no limit, save to device |
| Video snaps | Hold the shutter to record up to 10 seconds, a ring filling round it (or hold Space on it); a tap is still a photo. The clip loops while you add a caption and choose Mute, then Send to. It plays once for your friend, the caption over it, and is deleted. Stories play video too |
| Snaps | Send to several friends, groups and/or your story. Each snap opens once, then the file is deleted on the server |
| Groups | New chat on the Chat list: pick friends and name it to start a group of up to 32 people. Its row shows two of its people's avatars; its chat shows who said what, with their avatars; Send to lists your groups, and everyone in one opens a group snap once. The group card (tap its avatars) lists who is in it and has Leave group |
| Chat | Inbox with New / Opened / Delivered status. Chats delete 24h after they are read; tap one to keep it. While a friend types to you, their open thread shows their avatar and moving dots with "Ben is typing…", and their row in the Chat list says Typing… |
| Stories | Post for 24 hours, tap through friends' stories, see who watched yours |
| Friends | Search by username, requests, accept, remove, streaks for consecutive days |
| Puffcode | Your scannable profile code with your avatar inside; share or save it; scan friends' codes; `/add/<username>` links |
| Live | New snaps, chats, "opened" updates and typing arrive instantly (Server-Sent Events) |
| Notifications | A new snap, chat or friend request drops in as a banner at the top: the Puff mark on your friend's avatar, their name, and New snap or the start of their message. Tap it to open; swipe it up to put it away; it goes by itself after 4 seconds. Turn on Notifications in Profile to get system notifications while Poof is open in the background. The tab's title counts what is new: "(2) Poof" |

Not built: AR lenses, map, discover feed, screenshot alerts; adding people
to a group or renaming it after it is made.
Videos can't be drawn on or saved to the device yet. See
[`replica/parity.md`](replica/parity.md).

## Gestures

All gestures use pointer events, so they work with a finger, a pen or a
mouse, and each has a button or key that does the same.

- **Swipe between tabs.** Drag sideways on Chat, Camera or Stories and the
  screen follows, with its neighbour beside it (the screen last drawn for
  that tab). Let go past a quarter of the width, or flick, and it moves
  over; otherwise it springs back. Vertical drags are left to the browser,
  so lists scroll as usual. The shutter, the editor and drawing are never
  taken over. With reduced motion on, nothing slides: it follows your finger
  and then is simply there.
- **Snaps and stories.** Tap to go on; drag down to close, with the list
  behind showing through. In a story the left half goes back, the right
  half goes on, and press and hold pauses (the timer and the progress bar
  stop; holding Space on either half does it from the keyboard). Escape
  closes either.
- **Chat rows.** Swipe right to open the chat. Press and hold (or tap the
  avatar, which is also the keyboard way in) for the friend card: avatar,
  name, @username, streak, their Puffcode, Send a chat and Remove friend,
  which asks first. It closes with Close, Escape, a tap above it or a drag
  down, and focus goes back where it was.
- **Pull to refresh.** At the top of the Chat or Stories list, drag down:
  the list follows, with more resistance the further it goes, and Puff
  rises from behind it. Past the threshold his eyes go wide; let go there
  and the list reloads while he bobs, then he drifts off and the list
  settles back. Let go sooner and it springs back. It only starts with the
  list at the top and a drag downwards, so scrolling is never taken over.
  With reduced motion on, Puff just fades in and out. This one has no
  button: both lists update live anyway, and reloading the page does the
  same.

## Video snaps

Hold the shutter for a moment (350ms) and it records with the browser's
`MediaRecorder`: WebM (VP8 picture, Opus sound) where the browser can,
otherwise MP4 (older Safari). It stops when you let go, or at 10 seconds.
The microphone is asked for only once a hold starts, so taking a photo
never turns it on. If the microphone is blocked, the video records without
sound and says so.

**Mute sends no sound at all**, not a silenced player: the WebM's sound
track is taken out of the file before it is sent, without re-encoding it
(`public/webm.js`, which reads the file's EBML structure and drops the
audio track and its blocks). For MP4, a second copy records without the
microphone. A front-camera video plays mirrored, the way you saw it.

The server takes a video only on `POST /api/snaps` (the one route allowed a
body up to 16 MB, for videos up to 11 MB) and checks it really is a WebM or
MP4 by its first bytes. A video snap opens once like a photo and is deleted.
Story videos are served with byte ranges, which Safari needs to play them.

## Tests

```bash
npm test             # API: auth, friends, open-once snaps and videos, chat expiry, groups (members only, open once each, leaving), typing (live, friends only), live events with their sender, stories, streaks, security; WebM sound removal; app icons
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
- Add Web Push with a service worker, so notifications arrive while Poof is
  closed (today they come only while it is open in a tab, and not at all in
  Chrome on Android).
- Run a trademark check on the name "Poof" before using it publicly.
- Add reporting/blocking and an age gate: a messaging app for real users needs them.
