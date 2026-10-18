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

/** A cookie-keeping client that adds the CSRF header to every mutating request. */
export function client(app: Express) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => agent.post(url).set(CSRF_HEADER, CSRF_VALUE).send(body),
    put: (url: string, body: object = {}) => agent.put(url).set(CSRF_HEADER, CSRF_VALUE).send(body),
    patch: (url: string, body: object = {}) => agent.patch(url).set(CSRF_HEADER, CSRF_VALUE).send(body),
    delete: (url: string) => agent.delete(url).set(CSRF_HEADER, CSRF_VALUE),
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
