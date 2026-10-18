import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { DEFAULT_FUEL_PRICE_PER_GALLON, DRIVER_CLASSES, NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS } from '../../shared/equipment';
import type { DriverClass, MeResponse, User } from '../../shared/types';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth';
import type { AppContext } from '../context';
import { bool, transaction, type Db } from '../db';
import { HttpError, parse } from '../http';
import { getDriverProfile, getUserById } from '../mappers';

const THROTTLE_MAX_FAILURES = 10;
const THROTTLE_WINDOW_MS = 15 * 60_000;
/** Sweep stale throttle entries once the map grows past this, so it cannot grow without bound. */
const THROTTLE_SWEEP_SIZE = 1_000;

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(200);
const nameSchema = z.string().trim().min(1, 'Enter your name').max(80);

/** Optional free text where an empty string means "clear it". */
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable());

const phoneSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 ().-]{7,}$/, 'Enter a valid phone number')
    .nullable(),
);

const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: nameSchema,
    role: z.enum(['driver', 'shipper']),
    company: optionalText(120).optional(),
    phone: phoneSchema.optional(),
    driverClass: z.enum(['hotshot', 'semi']).optional(),
  })
  .refine((v) => v.role !== 'driver' || v.driverClass !== undefined, {
    path: ['driverClass'],
    message: 'Pick hotshot or semi',
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Enter your email').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

const updateMeSchema = z.object({
  name: nameSchema.optional(),
  company: optionalText(120).optional(),
  phone: phoneSchema.optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(200),
  newPassword: passwordSchema,
});

/** In-memory failed-login counter keyed by lowercased email. Per app instance, so tests stay isolated. */
function createLoginThrottle(now: () => Date) {
  const failures = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const cutoff = now().getTime() - THROTTLE_WINDOW_MS;
    const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  const sweep = () => {
    for (const key of [...failures.keys()]) recent(key);
  };

  return {
    /** Seconds until another attempt is allowed, or 0 when not blocked. */
    retryAfterSeconds(key: string): number {
      const kept = recent(key);
      if (kept.length < THROTTLE_MAX_FAILURES) return 0;
      const unblockAt = kept[kept.length - THROTTLE_MAX_FAILURES] + THROTTLE_WINDOW_MS;
      return Math.max(1, Math.ceil((unblockAt - now().getTime()) / 1000));
    },
    recordFailure(key: string): void {
      if (failures.size >= THROTTLE_SWEEP_SIZE) sweep();
      failures.set(key, [...recent(key), now().getTime()]);
    },
    clear(key: string): void {
      failures.delete(key);
    },
  };
}

type LoginThrottle = ReturnType<typeof createLoginThrottle>;

function assertNotThrottled(throttle: LoginThrottle, key: string, res: Response): void {
  const retryAfter = throttle.retryAfterSeconds(key);
  if (retryAfter === 0) return;
  res.set('Retry-After', String(retryAfter));
  throw new HttpError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Try again in a few minutes.');
}

/**
 * Compared against when the email is unknown, so a miss costs the same scrypt work as a wrong
 * password and response time does not reveal which emails have accounts.
 */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

function meResponse(db: Db, user: User): MeResponse {
  return { user, driverProfile: user.role === 'driver' ? getDriverProfile(db, user.id) : null };
}

function insertDriverProfile(db: Db, userId: string, driverClass: DriverClass, nowIso: string): void {
  const defaults = DRIVER_CLASSES[driverClass];
  const hotshot = driverClass === 'hotshot';
  db.prepare(
    `INSERT INTO driver_profiles (user_id, driver_class, equipment_types, trailer_length_ft, max_payload_lbs,
      has_cdl, cdl_class, available, max_deadhead_miles, min_rate_per_mile, mpg, fuel_price, rating, updated_at)
     VALUES (?, ?, '[]', ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?)`,
  ).run(
    userId,
    driverClass,
    hotshot ? 40 : 53,
    hotshot ? NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS : 45_000,
    bool(!hotshot),
    hotshot ? null : 'A',
    defaults.defaultMaxDeadheadMiles,
    defaults.defaultMinRatePerMile,
    defaults.defaultMpg,
    DEFAULT_FUEL_PRICE_PER_GALLON,
    nowIso,
  );
}

const emailTaken = () => new HttpError(409, 'email_taken', 'An account with this email already exists');

function isUniqueEmailViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: users\.email/.test(err.message);
}

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const throttle = createLoginThrottle(ctx.now);
  void getDummyHash();

  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body);
    const exists = ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email);
    if (exists) throw emailTaken();

    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    const nowIso = ctx.now().toISOString();
    try {
      transaction(ctx.db, () => {
        ctx.db
          .prepare(
            'INSERT INTO users (id, email, password_hash, name, role, company, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id, input.email, passwordHash, input.name, input.role, input.company ?? null, input.phone ?? null, nowIso);
        if (input.role === 'driver') insertDriverProfile(ctx.db, id, input.driverClass!, nowIso);
      });
    } catch (err) {
      // Two sign-ups for one email can both pass the check above while hashing.
      if (isUniqueEmailViolation(err)) throw emailTaken();
      throw err;
    }

    setSessionCookie(res, createSession(ctx, id));
    res.status(201).json(meResponse(ctx.db, getUserById(ctx.db, id)!));
  });

  router.post('/login', async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    assertNotThrottled(throttle, email, res);

    const row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
      | { id: string; password_hash: string }
      | undefined;
    const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
    if (!row || !ok) {
      throttle.recordFailure(email);
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    }

    throttle.clear(email);
    setSessionCookie(res, createSession(ctx, row.id));
    res.json(meResponse(ctx.db, getUserById(ctx.db, row.id)!));
  });

  router.post('/logout', (req, res) => {
    if (req.sessionHash) destroySession(ctx, req.sessionHash);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(meResponse(ctx.db, currentUser(req)));
  });

  router.patch('/me', requireAuth, (req, res) => {
    const user = currentUser(req);
    const input = parse(updateMeSchema, req.body);
    ctx.db
      .prepare('UPDATE users SET name = ?, company = ?, phone = ? WHERE id = ?')
      .run(
        input.name ?? user.name,
        input.company === undefined ? user.company : input.company,
        input.phone === undefined ? user.phone : input.phone,
        user.id,
      );
    res.json(meResponse(ctx.db, getUserById(ctx.db, user.id)!));
  });

  router.post('/password', requireAuth, async (req, res) => {
    const user = currentUser(req);
    const input = parse(changePasswordSchema, req.body);
    const key = user.email.toLowerCase();
    // Shares the login throttle so a stolen session cannot be used to brute-force the password.
    assertNotThrottled(throttle, key, res);

    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throttle.recordFailure(key);
      throw new HttpError(400, 'invalid_password', 'Current password is incorrect', [
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }

    throttle.clear(key);
    const passwordHash = await hashPassword(input.newPassword);
    transaction(ctx.db, () => {
      ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      // Sign out every other device; the session making the change stays valid.
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, req.sessionHash ?? '');
    });
    res.status(204).end();
  });

  return router;
}
