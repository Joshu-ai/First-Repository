# HaulMatch

**Loads that fit your rig.**

HaulMatch is a two-sided load board for **hotshot** drivers (a pickup, usually a 1-ton dually, pulling a
gooseneck, bumper pull, dovetail or car hauler) and **semi** drivers (Class 8 tractor-trailers), and for
the **shippers and brokers** who need freight moved.

Shippers post loads. Each driver gets the loads their rig can legally and physically haul, ranked by a
0–100 match score that weighs deadhead, pay, fit, timing and lane. A driver books with a tap, or sends a
request, and the shipper accepts it. Messages and status changes reach both sides live.

## Features

### For drivers

- **Rig setup wizard**: rig type, equipment, deck length, payload, CDL class and endorsements, where you're
  empty, and preferences (max deadhead, minimum all-in $/mi, preferred and avoided states, mpg, diesel price).
- **Ranked load board.** Loads you can't haul are hidden, and the rest are sorted by match score. Each card
  shows the lane, freight, posted rate and $/mi, deadhead, all-in $/mi, and estimated profit after fuel.
  - Filters for pickup near a city (with radius), destination states, equipment, minimum $/mi, max weight,
    pickup dates and hazmat, plus a text search.
  - Six sorts (best, rate, deadhead, pickup, newest, profit), and list and map views.
  - "Show loads I can't take" lists the loads that don't fit, each with the reasons.
- **Load detail**:
  - Every check (equipment, weight, length, CDL, hazmat, tanker, team, avoided state, deadhead, timing,
    rate) and the score breakdown.
  - A money panel with fuel and profit, a route map, and backhauls near the drop.
- **Booking.** *Book now* on instant-book loads. Otherwise *Request load*, with an optional note and a
  counter-offer.
- **Trips**: active loads, open requests and history. From here a driver marks a load *Picked up* and then
  *Delivered*, withdraws a request, or gives a booked load back before pickup.
- **Load alerts**: saved searches that send a notification when a matching load posts that you can
  actually haul. HaulMatch also sends a "hot match" alert to a few available drivers when a new load
  scores 85 or more for them.
- **"I'm empty in…"**: one tap updates your location and availability, and the board re-ranks.

### For shippers and brokers

- **Post, edit, repost or cancel a load.**
  - Road miles appear as soon as both cities are picked, with a market rate estimate (low, suggested,
    high, and $/mi).
  - An *Open to hotshot* switch, with a warning when the freight is too big for a typical hotshot.
  - Instant-book or review-requests mode.
- **Dashboard**: stat tiles, loads by status, and a *Requests waiting* panel with Accept and Decline on
  each row.
- **Load detail**:
  - Each request shows the driver card (rig, capacity, CDL, rating, deadhead, phone once there's a
    relationship), their offer and note, and how well they fit, worded for the shipper.
  - Recommended drivers with *Invite to book*.
  - A status timeline from posted to delivered.
- **Live updates.** Requests, bookings, pickups and deliveries arrive without reloading.

### For both

- Messages per load and driver, with live delivery and unread counts. Notifications come through a bell
  and toasts, and both update live over Server-Sent Events.
- A mobile-first layout:
  - A bottom tab bar on phones and tablets, a top bar on desktop, and 44px or larger tap targets.
  - Primary actions pinned within thumb reach.
  - A full dark theme.
  - Real labels, visible focus, `aria-live` toasts, and color is never the only signal.

## How matching works

`shared/matching.ts` → `matchLoad(load, driver, { now, ignoreDeadheadLimit })` returns a `MatchResult`:
eligibility, the score, every check, and the money.

**Hard checks.** A load is ineligible if any of these fail:

| Check | Rule |
|---|---|
| status | The load is open and its pickup window has not closed. |
| equipment | The load accepts at least one trailer type the driver runs. |
| weight / length | The load fits within the driver's max payload and deck length. |
| cdl | Semi-only equipment needs a Class A CDL. A hotshot without a Class A CDL is capped at 10,000 lbs, because a combination of 26,001 lbs or more needs Class A. A Class B CDL does not cover combinations. |
| hazmat / tanker | Needs a CDL with the H or N endorsement. |
| team | A team load needs a team driver. |
| avoid_state | The load delivers to a state the driver avoids. |
| deadhead | The load is within the driver's max deadhead. This check becomes **soft** (scored, not enforced) on the load detail page, for backhauls, for shipper views, and when the driver searches "pickup near" another city, because then they are planning the next run. |
| timing | The driver can reach pickup (at 50 mph from when they are free) before the window closes. |

`rate` is a soft check. Pay under the driver's minimum all-in $/mi caps the rate component at 30.

**Score (0–100, eligible loads only)** is a weighted sum of five components, each 0–100:

| Component | Weight | How it is scored |
|---|---|---|
| rate | 0.35 | All-in $/mi (rate ÷ loaded + deadhead miles) against the equipment benchmark: 70% of benchmark scores 0, and 120% or more scores 100. |
| deadhead | 0.30 | 100 at the pickup, falling linearly to 0 at the driver's max deadhead. 60 if the driver has no location. |
| timing | 0.15 | 100 if pickup opens within 12 h of when the driver is free, easing to 20 over the following 3½ days of waiting. |
| fit | 0.10 | 60 to 100 depending on how well the freight uses the deck or payload (full at 80% use). |
| lane | 0.10 | Higher when the load delivers to a preferred state, or closes at least 25% of the distance home. |

Highlights ("Pickup is close by", "Pays above market", "Heads toward home", and others) explain the score
in plain words. Estimated profit is the rate minus fuel for loaded plus deadhead miles, at the driver's
mpg and diesel price.

## Quick start

Requires **Node 22.5+**, for the built-in `node:sqlite`.

```bash
cd haulmatch
npm install
npm run dev        # API on http://localhost:4000 + Vite on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173. On first start the API creates `data/haulmatch.db` and seeds demo data.

### Demo logins

All demo accounts use the password **`demo1234`**. The login page also has one-tap demo buttons.

| Email | Who |
|---|---|
| `hotshot@demo.haulmatch.app` | Cody Ramirez: non-CDL hotshot, 40' gooseneck, 10,000 lbs, empty in Odessa TX, home Midland TX |
| `semi@demo.haulmatch.app` | Marcus Bell: CDL-A flatbed and step deck, 48', 47,000 lbs, Dallas TX, hazmat endorsement |
| `shipper@demo.haulmatch.app` | Dana Whitfield, Lone Star Oilfield Supply, Houston TX |

The seed also creates 4 more shippers and 10 more drivers, about 170 open loads on real freight corridors
and oilfield and ag hotshot lanes, booking history, pending requests, message threads, notifications and
saved searches. Run `npm run seed` to wipe the database and reseed it.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API (tsx watch) and Vite dev server together |
| `npm run build` | Typecheck, then build the client into `dist/` |
| `npm start` | Production: serves `dist/` and the API on `PORT` (default 4000) |
| `npm run seed` | Reset the database and load the demo data |
| `npm run typecheck` | `tsc --noEmit` over client, server, shared and tests |
| `npm test` | Vitest: shared domain logic, every API route (supertest), seed data, client helpers |
| `npm run test:e2e` | Playwright: builds, starts the server on a fresh seeded in-memory database, runs desktop and mobile projects |

Environment variables:

- `PORT`: the server port.
- `HAULMATCH_DB`: the SQLite file path, or `:memory:`.
- `HAULMATCH_SEED=0`: skip auto-seeding an empty database.
- `NODE_ENV=production`: serve `dist/` and set secure cookies.
- `HAULMATCH_INSECURE_COOKIES=1`: allow cookies over plain http in production, for local testing.

## Architecture

- **TypeScript everywhere, ESM.**
- **Server**: Express 5, the built-in `node:sqlite` (`DatabaseSync`), and zod 4 for validation. Sessions are
  httpOnly cookies backed by sha256-hashed tokens. Passwords are hashed with scrypt.
- **CSRF**: every mutating request needs the `X-Requested-With: HaulMatch` header.
- **Live updates**: Server-Sent Events. Notifications and pushes go out only after the database
  transaction commits.
- **Booking safety**: booking runs in a single `BEGIN IMMEDIATE` transaction that re-checks the load's
  status, so two drivers cannot both book one load.
- **Client**: React 19, react-router 7 and Vite 6. Styling is plain CSS with custom-property design tokens,
  with no UI kit. Maps use Leaflet via react-leaflet. Every page is lazy-loaded.

```
haulmatch/
├── shared/            Contract and domain logic used by both sides
│   ├── types.ts       Every DTO (the source of truth for data shapes)
│   ├── matching.ts    matchLoad / compareMatches: checks, score, money
│   ├── rates.ts       estimateRate: market rate estimate per lane and equipment
│   ├── equipment.ts   Equipment catalogue, class defaults, benchmarks, CDL limits
│   ├── geo.ts         Great-circle miles × circuity = road miles, drive hours, states
│   ├── cities.ts      City search over data/cities.json + data/extra-cities.json
│   └── api.ts         CSRF header and session cookie names
├── server/
│   ├── index.ts       Entry point (opens the db, seeds if empty, listens)
│   ├── app.ts         Router wiring, static client in production
│   ├── db.ts          Schema and transaction helper
│   ├── auth.ts        Sessions, password hashing, requireAuth / requireRole
│   ├── events.ts      SSE hub, publish() and notify()
│   ├── http.ts        HttpError, zod parse(), CSRF guard, error handler
│   ├── mappers.ts     Rows → DTOs
│   ├── filters.ts     Load search filters (query parsing, saved-search schema, load-only filtering)
│   ├── alerts.ts      Saved-search and hot-match alerts for new loads
│   ├── seed.ts        Deterministic demo data (also runnable as a script)
│   └── routes/        auth, drivers, meta, notifications, savedSearches, loads, bookings, shipper, messages
├── client/
│   ├── index.html
│   └── src/
│       ├── App.tsx    Routes and providers
│       ├── styles.css Design tokens (light and dark) and component styles
│       ├── lib/       api client, auth, realtime (SSE), formatters, hooks, routes, filters
│       ├── components/ AppShell, LoadCard, ScoreBadge, MatchDetails, maps, forms, modals, toasts…
│       └── pages/     public/ (landing, login, signup), driver/, shipper/, common/ (messages, notifications, account)
├── tests/             Vitest: shared/, server/ (supertest against an in-memory db), client/
├── e2e/               Playwright specs (desktop and mobile)
└── docs/SPEC.md       The build contract: API, rules, routes, design direction
```

## API

All endpoints live under `/api` and speak JSON. Errors look like `{ error: { code, message, details? } }`.
The full contract (every route, body, rule and status code) is in **[docs/SPEC.md](docs/SPEC.md)**. In
brief:

- **Auth.** `/api/auth`: register, login (throttled), logout, me, profile edits, password change.
- **Drivers.** `/api/drivers`:
  - `me/profile` and `me/location` (rig and "I'm empty in…").
  - `me/stats`, and a public driver summary. The phone is shown only to shippers the driver has dealt with.
- **Loads.** `/api/loads`:
  - Search with matching, detail, post, edit and cancel.
  - Book or request, trip status, backhauls, recommended drivers, invite, and a load's bookings.
- **Bookings.** `/api/bookings`: list, accept, decline, withdraw.
- **Shipper.** `/api/shipper`: own loads by status, and stats.
- **Messages.** `/api/threads`, plus `/api/loads/:id/messages` to read, send and mark read.
- **Alerts and notifications.**
  - `/api/saved-searches`: load alerts.
  - `/api/notifications`, plus `/api/events` for the SSE stream.
- **Reference data.** `/api/cities`, `/api/meta`, and `/api/rates/estimate`.

## What is demo-grade (read before relying on it)

- **Rates are benchmarks, not live market data.**
  - Per-mile benchmarks per equipment type (dry van $2.10, reefer $2.45, flatbed $2.55, hotshot
    $1.70–1.95) and the default diesel price ($3.75/gal) reflect 2025 to early-2026 national averages.
  - They run well behind late-2026 spot rates.
  - Estimates add a short-haul uplift and a minimum charge, then round to $25.
- **Miles are approximate.** Road miles are great-circle distance × 1.17 circuity, not routed miles. Drive
  time assumes 50 mph and ignores hours-of-service rules (11 h driving, then a 10 h break), so very long
  deadheads look more reachable than they are.
- **Hazmat** checks treat every hazmat load as placarded. The avoid-state check looks only at the delivery
  state.
- **City data.** Cities come from a static dataset of US freight hubs, with GeoNames populations and
  coordinates.
- **No payments, invoicing, quick-pay or factoring.**
- **No ELD, GPS tracking or documents.** There is no BOL or POD upload. "Picked up" and "Delivered" are
  taps.
- **No carrier vetting.** MC and DOT numbers are free text and are not checked against FMCSA (authority,
  insurance or safety rating). There is no identity or broker-bond verification.
- **Single-instance by design.** SQLite on local disk, the in-memory login throttle and the in-process SSE
  hub all assume one server process. Scaling out needs a shared database, rate limiter and pub/sub.
- **Basic notifications.** Notifications appear in the app only (bell and toasts). There is no email, SMS
  or push.
- **Maps** use OpenStreetMap tiles. Without network access they show pins and lines on a blank
  background.
