import request from 'supertest';
import type { Express } from 'express';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import { createApp } from '../server/app';
import { openDb, type Db } from '../server/db';
import type { DriverClass, MeResponse, Role } from '../shared/types';

/** A pinned clock: Sunday 2026-10-18 12:00 UTC. Advance it with clock.advance(hours). */
export function createClock(start = '2026-10-18T12:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (hours: number) => {
      current += hours * 3_600_000;
    },
    set: (iso: string) => {
      current = new Date(iso).getTime();
    },
  };
}

export interface TestApp {
  app: Express;
  db: Db;
  clock: ReturnType<typeof createClock>;
}

export function createTestApp(start?: string): TestApp {
  const db = openDb(':memory:');
  const clock = createClock(start);
  const app = createApp({ db, now: clock.now });
  return { app, db, clock };
}

/**
 * A cookie-keeping client that adds the CSRF header to every mutating request.
 * Pass `cookie` to start out signed in (see seedUser).
 */
export function client(app: Express, cookie?: string) {
  const agent = request.agent(app);
  const withCookie = <T extends request.Test>(req: T): T => (cookie ? (req.set('Cookie', cookie) as T) : req);
  return {
    agent,
    get: (url: string) => withCookie(agent.get(url)),
    post: (url: string, body: object = {}) => withCookie(agent.post(url).set(CSRF_HEADER, CSRF_VALUE).send(body)),
    put: (url: string, body: object = {}) => withCookie(agent.put(url).set(CSRF_HEADER, CSRF_VALUE).send(body)),
    patch: (url: string, body: object = {}) => withCookie(agent.patch(url).set(CSRF_HEADER, CSRF_VALUE).send(body)),
    delete: (url: string) => withCookie(agent.delete(url).set(CSRF_HEADER, CSRF_VALUE)),
  };
}

export type TestClient = ReturnType<typeof client>;

let counter = 0;

/** Registers a user and returns a signed-in client plus the /me payload. */
export async function signUp(
  app: Express,
  opts: { role: Role; driverClass?: DriverClass; name?: string; email?: string; company?: string } ,
): Promise<{ c: TestClient; me: MeResponse }> {
  counter += 1;
  const c = client(app);
  const res = await c.post('/api/auth/register', {
    email: opts.email ?? `${opts.role}${counter}@test.example`,
    password: 'correct-horse-battery',
    name: opts.name ?? `${opts.role} ${counter}`,
    role: opts.role,
    company: opts.company,
    driverClass: opts.role === 'driver' ? (opts.driverClass ?? 'hotshot') : undefined,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { c, me: res.body as MeResponse };
}

// ---- Direct-to-database fixtures (no dependency on the auth or loads routes) ----

import { randomUUID } from 'node:crypto';
import { createSession, hashPasswordSync } from '../server/auth';
import { bool } from '../server/db';
import { getLoadById } from '../server/mappers';
import { roadMiles } from '../shared/geo';
import { placeForCityId } from '../shared/cities';
import { DEFAULT_FUEL_PRICE_PER_GALLON, DRIVER_CLASSES } from '../shared/equipment';
import type { DriverProfile, EquipmentCode, Load, User } from '../shared/types';
import { SESSION_COOKIE } from '../shared/api';

const FIXTURE_PASSWORD_HASH = hashPasswordSync('correct-horse-battery');

export interface DriverFixture {
  driverClass?: DriverClass;
  equipmentTypes?: EquipmentCode[];
  trailerLengthFt?: number;
  maxPayloadLbs?: number;
  hasCdl?: boolean;
  endorsements?: DriverProfile['endorsements'];
  teamDriver?: boolean;
  currentCityId?: string | null;
  homeCityId?: string | null;
  available?: boolean;
  availableFrom?: string | null;
  maxDeadheadMiles?: number;
  minRatePerMile?: number;
  preferredStates?: string[];
  avoidStates?: string[];
}

/**
 * Inserts a user (and driver profile for drivers) straight into the db and returns a client
 * already signed in through a real session cookie. Drivers default to a complete hotshot
 * gooseneck profile parked in Houston, TX.
 */
export function seedUser(
  t: TestApp,
  opts: { role: Role; name?: string; email?: string; company?: string | null; phone?: string | null; driver?: DriverFixture },
): { c: TestClient; user: User } {
  counter += 1;
  const id = randomUUID();
  const createdAt = t.clock.now().toISOString();
  const user: User = {
    id,
    email: opts.email ?? `${opts.role}-fixture-${counter}@test.example`,
    name: opts.name ?? `${opts.role === 'driver' ? 'Driver' : 'Shipper'} ${counter}`,
    role: opts.role,
    company: opts.company ?? (opts.role === 'shipper' ? `Freight Co ${counter}` : null),
    phone: opts.phone ?? `555-010-${String(counter).padStart(4, '0')}`,
    createdAt,
  };
  t.db
    .prepare('INSERT INTO users (id, email, password_hash, name, role, company, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.email, FIXTURE_PASSWORD_HASH, user.name, user.role, user.company, user.phone, createdAt);

  if (opts.role === 'driver') {
    const d = opts.driver ?? {};
    const driverClass = d.driverClass ?? 'hotshot';
    const defaults = DRIVER_CLASSES[driverClass];
    const hotshot = driverClass === 'hotshot';
    const hasCdl = d.hasCdl ?? !hotshot;
    t.db
      .prepare(
        `INSERT INTO driver_profiles (user_id, driver_class, equipment_types, trailer_length_ft, max_payload_lbs,
          truck_description, has_cdl, cdl_class, endorsements, team_driver, current_city_id, home_city_id, available,
          available_from, max_deadhead_miles, min_rate_per_mile, preferred_states, avoid_states, mpg, fuel_price,
          rating, completed_loads, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        driverClass,
        JSON.stringify(d.equipmentTypes ?? (hotshot ? ['HS_GOOSENECK'] : ['FLATBED'])),
        d.trailerLengthFt ?? (hotshot ? 40 : 48),
        d.maxPayloadLbs ?? (hotshot ? 16_500 : 45_000),
        hotshot ? '2023 Ram 3500 dually + 40ft gooseneck' : '2021 Freightliner Cascadia + 48ft flatbed',
        bool(hasCdl),
        hasCdl ? 'A' : null,
        JSON.stringify(d.endorsements ?? []),
        bool(d.teamDriver ?? false),
        d.currentCityId === undefined ? 'houston-tx' : d.currentCityId,
        d.homeCityId ?? null,
        bool(d.available ?? true),
        d.availableFrom ?? null,
        d.maxDeadheadMiles ?? defaults.defaultMaxDeadheadMiles,
        d.minRatePerMile ?? defaults.defaultMinRatePerMile,
        JSON.stringify(d.preferredStates ?? []),
        JSON.stringify(d.avoidStates ?? []),
        defaults.defaultMpg,
        DEFAULT_FUEL_PRICE_PER_GALLON,
        4.8,
        12,
        createdAt,
      );
  }

  const token = createSession({ db: t.db, now: t.clock.now }, id);
  return { c: client(t.app, `${SESSION_COOKIE}=${token}`), user };
}

export interface LoadFixture {
  status?: Load['status'];
  originCityId?: string;
  destinationCityId?: string;
  pickupStart?: string;
  pickupEnd?: string;
  deliveryBy?: string | null;
  equipmentTypes?: EquipmentCode[];
  weightLbs?: number;
  lengthFt?: number;
  commodity?: string;
  hazmat?: boolean;
  teamRequired?: boolean;
  rateUsd?: number;
  bookingMode?: Load['bookingMode'];
  bookedDriverId?: string | null;
}

/**
 * Inserts a load directly. Defaults: open Houston, TX -> Odessa, TX hotshot/flatbed load,
 * picking up tomorrow, 9,000 lbs, 30 ft, $1,400, request mode.
 */
export function insertLoad(t: TestApp, shipperId: string, f: LoadFixture = {}): Load {
  const id = randomUUID();
  const now = t.clock.now();
  const origin = f.originCityId ?? 'houston-tx';
  const destination = f.destinationCityId ?? 'odessa-tx';
  const miles = roadMiles(placeForCityId(origin)!, placeForCityId(destination)!);
  const pickupStart = f.pickupStart ?? new Date(now.getTime() + 20 * 3_600_000).toISOString();
  const pickupEnd = f.pickupEnd ?? new Date(now.getTime() + 30 * 3_600_000).toISOString();
  t.db
    .prepare(
      `INSERT INTO loads (id, shipper_id, status, origin_city_id, dest_city_id, pickup_start, pickup_end, delivery_by,
        equipment_types, weight_lbs, length_ft, commodity, notes, load_size, hazmat, tarp_required, team_required,
        rate_usd, miles, booking_mode, reference_number, booked_driver_id, booked_rate_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'full', ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      id,
      shipperId,
      f.status ?? 'open',
      origin,
      destination,
      pickupStart,
      pickupEnd,
      f.deliveryBy ?? null,
      JSON.stringify(f.equipmentTypes ?? ['HS_GOOSENECK', 'FLATBED']),
      f.weightLbs ?? 9_000,
      f.lengthFt ?? 30,
      f.commodity ?? 'Oilfield pipe',
      bool(f.hazmat ?? false),
      bool(f.teamRequired ?? false),
      f.rateUsd ?? 1_400,
      miles,
      f.bookingMode ?? 'request',
      f.bookedDriverId ?? null,
      f.bookedDriverId ? (f.rateUsd ?? 1_400) : null,
      now.toISOString(),
      now.toISOString(),
    );
  return getLoadById(t.db, id)!;
}
