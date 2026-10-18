# HaulMatch build spec

HaulMatch is a two-sided load board. **Shippers and brokers** post loads. **Drivers** (hotshot
or semi) get the loads that fit their rig, ranked by a match score, and book them in a tap.
Tagline: *Loads that fit your rig.*

This file is the contract every part of the codebase builds against. The source of truth for
data shapes is `shared/types.ts`; this doc says how the pieces behave.

## Stack and layout

- Node 22, TypeScript everywhere, ESM, extensionless relative imports (`moduleResolution: bundler`).
- **Server**: Express 5 + built-in `node:sqlite` (`DatabaseSync`), zod 4 for validation, run with `tsx`.
- **Client**: React 19 + react-router 7 (library mode, `import { ... } from 'react-router'`), Vite 6,
  plain CSS with custom properties (no Tailwind, no UI kit), Leaflet via react-leaflet 5 for maps.
- **Tests**: vitest (`tests/**/*.test.ts`), supertest for the API, Playwright for e2e (`e2e/`).

```
shared/      types.ts (DTOs) · equipment.ts · geo.ts · cities.ts (+ data/*.json) · matching.ts · rates.ts · api.ts
server/      index.ts · app.ts (router wiring) · db.ts (schema) · context.ts · auth.ts · events.ts (SSE + notify)
             http.ts (errors, zod parse, CSRF) · mappers.ts (rows -> DTOs) · filters.ts (search filters) · alerts.ts · seed.ts · routes/*.ts
client/      index.html · src/main.tsx · src/App.tsx · src/styles.css · src/lib/* · src/components/* · src/pages/**
tests/       helpers.ts · shared/*.test.ts · server/*.test.ts · client/*.test.ts (pure client lib + form helpers)
e2e/         *.spec.ts (Playwright)
```

Scripts: `npm run dev` (API on :4000 + Vite on :5173 with `/api` proxy), `npm run build`,
`npm start` (serves `dist/` + API), `npm test`, `npm run test:e2e`, `npm run seed` (reset + demo data),
`npm run typecheck`.

## Conventions (server)

- Every router module exports `xRouter(ctx: AppContext): Router`. `ctx.now()` is the clock: never call
  `new Date()` for business logic in routes, so tests can pin time.
- Validate every body/query with zod via `parse(schema, value)` from `server/http.ts`; throw the
  `HttpError` helpers (`badRequest`, `notFound`, `forbidden`, `conflict`, or `new HttpError(422, 'not_eligible', ...)`).
  Errors serialize as `{ error: { code, message, details? } }`.
- `node:sqlite` does not bind booleans or `undefined`: use `bool()` from `db.ts` and `?? null`.
- Wrap multi-statement writes in `transaction(db, fn)` (BEGIN IMMEDIATE), and re-check state inside
  the transaction (e.g. "is the load still open?") so two drivers cannot both book one load.
- Map rows with `server/mappers.ts` (`toLoad`, `getLoadById`, `LOAD_SELECT`, `getDriverProfile`, ...).
  Locations are stored as city ids and resolved through `shared/cities.ts`.
- Live updates: `notify(ctx, userId, {type, title, body, link})` stores a notification and pushes it over SSE;
  `publish(userId, event)` pushes a raw `ServerEvent`. Links are client routes (see below).
- Auth: `requireAuth`, `requireRole('driver' | 'shipper')`, `currentUser(req)` from `server/auth.ts`.
- Mutating requests need header `X-Requested-With: HaulMatch` (enforced globally by `csrfGuard`).
- Search filters live in `server/filters.ts`: `parseFilterQuery(req.query)` for `GET /api/loads`, `filtersSchema`
  for saved-search bodies, `loadPassesFilters(load, filters)` for the load-only part of filtering (list + alerts).
  `equipmentCodeSchema`, `stateCodeSchema`, `isoDateSchema` are reusable zod pieces.
- Seeding uses `hashPasswordSync` from `server/auth.ts` (same format as `hashPassword`).
- IDs are `crypto.randomUUID()`. Money is whole dollars (integers) except per-mile rates.
- Never leak another user's private data: password hashes never leave the server; a driver's phone
  is only shown to a shipper who has a booking/request/thread with that driver, or to the driver.

## API (all under `/api`, JSON)

Status codes: 200 OK, 201 created, 204 no content, 400 validation, 401 signed out, 403 wrong role/owner,
404 missing or not visible, 409 state conflict, 422 not eligible.

### Auth — `routes/auth.ts` (mounted at `/api/auth`)
| Method | Path | Who | Body / query | Response |
|---|---|---|---|---|
| POST | `/register` | public | `{email, password (8–200), name (1–80), role, company?, phone?, driverClass? (required for drivers)}` | 201 `MeResponse`, sets cookie. 409 `email_taken`. Drivers get a `driver_profiles` row with class defaults (see below) and `equipment_types = []`, so `profileComplete` is false until setup. |
| POST | `/login` | public | `{email, password}` | 200 `MeResponse`, sets cookie. 401 `invalid_credentials`. Throttle: 10 failed attempts per email per 15 min → 429 `too_many_attempts`. |
| POST | `/logout` | any | – | 204, deletes session, clears cookie |
| GET | `/me` | signed in | – | `MeResponse` or 401 |
| PATCH | `/me` | signed in | `{name?, company?, phone?}` | `MeResponse` |
| POST | `/password` | signed in | `{currentPassword, newPassword}` | 204; 400 if current is wrong |

Driver profile defaults on register: hotshot → `trailerLengthFt 40`, `maxPayloadLbs 10_000`
(the non-CDL ceiling), `hasCdl false`; semi → `53 ft`, `45_000 lbs`, `hasCdl true`, `cdlClass 'A'`.
Both: `maxDeadheadMiles`, `minRatePerMile`, `mpg` from `DRIVER_CLASSES`, fuel `DEFAULT_FUEL_PRICE_PER_GALLON`,
`available true`, rating 0, no location.

### Drivers — `routes/drivers.ts` (`/api/drivers`)
| Method | Path | Who | Body / query | Response |
|---|---|---|---|---|
| GET | `/me/profile` | driver | – | `DriverProfile` |
| PUT | `/me/profile` | driver | any subset of: `driverClass, equipmentTypes, trailerLengthFt (8–60), maxPayloadLbs (500–80000), truckDescription (≤120), mcNumber (≤12 digits or null), dotNumber (≤10 digits or null), hasCdl, cdlClass ('A'|'B'|null), endorsements, teamDriver, currentCityId (null ok), homeCityId (null ok), available, availableFrom (ISO or null), maxDeadheadMiles (0–1000), minRatePerMile (0–20), preferredStates, avoidStates (USPS codes), mpg (2–40), fuelPricePerGallon (1–15)` | `DriverProfile`. 400 if equipment does not belong to the (new) driverClass, a city id is unknown, or a state code is invalid. |
| PATCH | `/me/location` | driver | `{cityId, available?, availableFrom?}` | `DriverProfile` ("I'm empty in Tulsa") |
| GET | `/me/stats` | driver | – | `DriverStats` |
| GET | `/:id` | signed in | – | `DriverSummary` (phone nulled unless relationship, see conventions); 404 if not a driver |

### Meta — `routes/meta.ts` (mounted at `/api`)
| GET | `/cities?q=&limit=` | public | limit default 8, max 25 | `City[]` via `searchCities` |
|---|---|---|---|---|
| GET | `/cities/:id` | public | – | `City` or 404 |
| GET | `/meta` | public | – | `MetaResponse` |
| GET | `/rates/estimate?originCityId=&destinationCityId=&equipment=A,B` | public | – | `RateEstimate` (miles = `roadMiles`) |

### Notifications + live events — `routes/notifications.ts` (mounted at `/api`)
| GET | `/notifications?unread=1&limit=50` | signed in | – | `NotificationsResponse` newest first |
|---|---|---|---|---|
| POST | `/notifications/read` | signed in | `{ids?: string[]}` (omit = all) | `{unreadCount}` |
| GET | `/events` | signed in | – | SSE stream (`eventsHandler` from `server/events.ts`) |

### Saved searches / load alerts — `routes/savedSearches.ts` (`/api/saved-searches`, drivers)
| GET | `/` | `SavedSearch[]` newest first |
|---|---|---|
| POST | `/` `{name (1–60), filters: LoadSearchFilters, alertsEnabled? = true}` | 201 `SavedSearch`; max 20 per driver (409) |
| PATCH | `/:id` `{name?, filters?, alertsEnabled?}` | `SavedSearch` (404 if not yours) |
| DELETE | `/:id` | 204 |

### Loads — `routes/loads.ts` (`/api/loads`)
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/` | signed in | Query = `LoadSearchFilters` as strings (`equipment` and `destinationStates` comma-separated, booleans `true/false/1/0`) + `limit` (default 50, max 200) + `offset`. Only `status='open'` and `pickup_end >= now`. Drivers: each load gets `match = matchLoad(load, profile, {now})`; ineligible loads dropped unless `includeIneligible`; `originCityId+originRadiusMiles` filters by road miles from that city (and then the deadhead limit is soft, `ignoreDeadheadLimit: true`, because the driver is planning a run from there); `minRatePerMile` compares the posted `ratePerMile`; `q` matches commodity/city/notes/reference case-insensitively. Sorts: `best` (default for drivers, `compareMatches`), `rate` (ratePerMile desc), `deadhead` (asc, nulls last), `pickup` (pickupStart asc), `newest` (default for shippers), `profit` (estimatedProfitUsd desc). If the driver profile is incomplete, matches are null and `driverProfileComplete=false`. Response `LoadListResponse`. |
| GET | `/:id` | signed in | `LoadDetailResponse`. Open loads are visible to everyone signed in. Non-open loads only to the owning shipper, the booked driver, and drivers who have a booking row on it; otherwise 404. Drivers get `match` (with `ignoreDeadheadLimit: true`) and `myBooking`; the booked driver also gets `shipperPhone`. |
| POST | `/` | shipper | Body: `{originCityId, destinationCityId, pickupStart, pickupEnd, deliveryBy?, equipmentTypes (≥1), weightLbs (1–200000), lengthFt (1–100), commodity (1–120), notes? (≤2000), loadSize = 'full', hazmat = false, tarpRequired = false, teamRequired = false, rateUsd (50–100000), bookingMode = 'request', referenceNumber? (≤40)}`. Rules: origin ≠ destination; pickupEnd ≥ pickupStart; pickupEnd > now; deliveryBy ≥ pickupStart. `miles = roadMiles(origin, destination)`. After insert call `alertDriversForLoad(ctx, load)` (server/alerts.ts). 201 `Load`. |
| PATCH | `/:id` | owning shipper | Same fields, all optional. Only while `open`. Recompute miles. Notify drivers with pending requests that the load changed (`load_status`). |
| POST | `/:id/cancel` | owning shipper | `open` or `booked` only (409 otherwise). Pending/accepted bookings → `cancelled`, notify those drivers (`load_cancelled`). Returns `Load`. |
| POST | `/:id/book` | driver | Body `{message? (≤500), offerRateUsd? (50–100000)}`. Load must be open (409), profile complete (422 `profile_incomplete`), and every hard check of `matchLoad(..., {ignoreDeadheadLimit: true})` must pass (422 `not_eligible`, `details` = failed checks). One live booking per driver per load (409). **Instant** mode with no counter-offer → booking `accepted`, load `booked` (`booked_driver_id`, `booked_rate_usd = rateUsd`), other pending requests → `declined` + notified, shipper notified `load_booked`. Otherwise → booking `pending`, shipper notified `booking_request`. 201 `BookLoadResponse`. All in one transaction that re-checks status. |
| POST | `/:id/status` | booked driver | `{status: 'in_transit' | 'delivered'}`; allowed `booked→in_transit` (sets `picked_up_at`) and `in_transit→delivered` (sets `delivered_at`, driver `completed_loads + 1`). Notify shipper `load_status`. Returns `Load`. |
| GET | `/:id/backhauls` | driver | Open loads whose origin is within 150 road miles of this load's destination, matched as if the driver is at the destination and available at `deliveryBy ?? pickupEnd + driveHours(miles)`, `ignoreDeadheadLimit: true`; eligible only; best first; max 10. `LoadWithMatch[]`. |
| GET | `/:id/recommended-drivers` | owning shipper | Drivers with complete profiles and `available`, `matchLoad(load, driver, {ignoreDeadheadLimit: true})`, eligible only, best first, max 20, excluding drivers with a live booking on the load. `RecommendedDriver[]`. |
| POST | `/:id/invite` | owning shipper | `{driverId, message?}` → notify that driver (`load_match`, link to the load). Load must be open. 204. |
| GET | `/:id/bookings` | owning shipper | `Booking[]` newest first, each with `driver` (summary incl. phone) and `match`. |

### Shipper — `routes/shipper.ts` (`/api/shipper`, shippers)
| GET | `/loads?status=` | `Load[]` owned by the shipper, newest first. `status` = a `LoadStatus` or `active` (open+booked+in_transit). |
|---|---|---|
| GET | `/stats` | `ShipperStats` |

### Bookings — `routes/bookings.ts` (`/api/bookings`)
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/?status=` | signed in | Drivers: their bookings with `load`. Shippers: bookings on their loads with `load`, `driver`, `match`. Newest first. |
| POST | `/:id/accept` | owning shipper | Booking `pending` and load `open` (409 otherwise). Booking → `accepted`; load → `booked` with `booked_rate_usd = offerRateUsd ?? rateUsd`; other pending requests → `declined` (notify each); notify driver `booking_accepted`; publish `load_updated`/`booking_updated`. Returns `BookLoadResponse`. |
| POST | `/:id/decline` | owning shipper | `pending` only. Notify driver `booking_declined`. Returns `Booking`. |
| POST | `/:id/withdraw` | the booking's driver | `pending`, or `accepted` while load is still `booked` (not picked up). Accepted withdraw reopens the load (`open`, clears booked driver/rate). Notify shipper `booking_withdrawn`. Returns `Booking`. |

### Messages — `routes/messages.ts` (mounted at `/api`)
A thread is one load + one driver. Shippers see threads on loads they own; drivers see their own.
| GET | `/threads` | `Thread[]` sorted by last activity |
|---|---|---|
| GET | `/loads/:loadId/messages?driverId=` | `Message[]` oldest first; drivers omit `driverId` (self). Marks the counterpart's messages read. |
| POST | `/loads/:loadId/messages` | `{body (1–2000), driverId? (required for shippers)}` → 201 `Message`. A driver may message about any load visible to them. A shipper may only message about loads they own, to a driver who is a driver account. Publishes `{type:'message'}` to the other side and `notify`s them (`message`). |
| POST | `/loads/:loadId/messages/read` | `{driverId?}` → 204 |

### Alerts — `server/alerts.ts`
`alertDriversForLoad(ctx, load)`: for each saved search with alerts on whose filters match the new load
**and** the driver is eligible (`matchLoad` hard checks pass; a search with `originCityId` treats the deadhead limit as soft, like the board), notify once per driver (`load_match`,
"New load: Houston, TX → Odessa, TX · $1,400", link `/driver/loads/:id`). Also notify up to 5 other
available drivers with score ≥ 85 ("Hot match near you"). Never notify the same driver twice for one load.

## Client routes (react-router)

Public: `/` Landing, `/login`, `/signup?role=driver|shipper&class=hotshot|semi`, `*` NotFound.
Driver (role guard; incomplete profile → redirect to `/driver/setup`):
`/driver/setup` Setup wizard · `/driver/loads` Load board · `/driver/loads/:id` Load detail ·
`/driver/trips` My trips & requests · `/driver/alerts` Saved searches/alerts · `/driver/profile` Rig & preferences.
Shipper (role guard): `/shipper` Dashboard · `/shipper/loads/new` Post load (`?from=<loadId>` prefills a repost) ·
`/shipper/loads/:id` Load detail with requests and recommended drivers · `/shipper/loads/:id/edit` Edit load.
Both: `/messages` and `/messages/:loadId/:driverId` · `/notifications` · `/account`.
After sign-in: drivers → `/driver/loads` (or setup), shippers → `/shipper`.

Page files: `client/src/pages/public/{Landing,Login,Signup,NotFound}.tsx`,
`client/src/pages/driver/{Setup,LoadBoard,LoadDetail,Trips,Alerts,Profile}.tsx`,
`client/src/pages/shipper/{Dashboard,PostLoad,LoadDetail}.tsx` (PostLoad handles new, edit and repost),
`client/src/pages/common/{Messages,Notifications,Account}.tsx`. Each default-exports its page component.

## Design direction

Drivers use this on a phone in the cab, often in sun glare, often with gloves; shippers use it at a desk.
- Mobile-first, responsive to desktop. Driver nav on mobile is a bottom tab bar (Loads, Trips, Alerts,
  Messages, Profile); desktop uses a top bar. Tap targets ≥ 44px. Primary actions reachable by thumb.
- Utilitarian, high-contrast, calm. Safety-orange brand accent on a deep navy/asphalt ink, light
  neutral surfaces, plus a full dark theme via `prefers-color-scheme`. Tokens as CSS custom properties
  in `client/src/styles.css` (`--bg, --surface, --surface-2, --ink, --muted, --line, --brand, --brand-ink,
  --accent, --ok, --warn, --bad, --radius, --shadow`...). System font stack (no web fonts), `tabular-nums`
  for money, miles and weights.
- The match score is the hero of a load card: score ring/badge, then lane (City, ST → City, ST), the
  money (rate, $/mi, est. profit after fuel), deadhead, pickup time, equipment chips, weight/length.
- Every list has loading, empty and error states. Every form shows field errors from the API.
  Use plain language a driver would use ("deadhead", "all-in", "$/mi", "dually", "gooseneck").
- Accessible: real labels, visible focus, `aria-live` toasts, keyboard reachable, color is never the only signal.

## Demo data (server/seed.ts)

`seedDatabase(db, {now})` is deterministic (seeded PRNG) and idempotent on an empty db. Demo logins
(password `demo1234` for all), shown on the login page:
- `hotshot@demo.haulmatch.app` — non-CDL hotshot, 40' gooseneck, 10,000 lbs, Odessa TX, home Midland TX
- `semi@demo.haulmatch.app` — CDL-A flatbed/step deck, 48', 47,000 lbs, Dallas TX, hazmat endorsement
- `shipper@demo.haulmatch.app` — Lone Star Oilfield Supply, Houston TX (broker-style shipper)
Plus ~4 more shippers and ~10 more drivers (mix of hotshot gooseneck/dovetail/car hauler and semi dry
van/reefer/flatbed/step deck/RGN/tanker/team) spread across the US, ~160 open loads over the next 1–7
days weighted to real freight corridors and to oilfield/ag hotshot lanes, many accepting both hotshot
and semi flatbed, rates near `estimateRate` ±15%; some booked/in-transit/delivered history, pending
requests on the demo shipper's loads, a few message threads, notifications and saved searches.
