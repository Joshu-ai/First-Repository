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
import { closeSessionStreams } from '../events';
import { HttpError, parse } from '../http';
import { getDriverProfile, getUserById } from '../mappers';
import { createThrottle, type Throttle } from '../throttle';

const LOGIN_MAX_FAILURES = 10;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

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

/**
 * Claims one sign-in attempt for key (a lowercased email) before the password check, or answers 429.
 * Claiming first means guesses sent all at once count toward the limit too: at most
 * LOGIN_MAX_FAILURES are ever checked at a time, recorded failures and checks still running together.
 * Call the returned function once the attempt is over.
 */
function claimAttempt(throttle: Throttle, key: string, res: Response): () => void {
  const release = throttle.reserve(key);
  if (release) return release;
  res.set('Retry-After', String(Math.max(1, throttle.retryAfterSeconds(key))));
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
  // Failed sign-ins per email, shared by login and password change.
  const throttle = createThrottle({ max: LOGIN_MAX_FAILURES, windowMs: LOGIN_FAILURE_WINDOW_MS, now: ctx.now });
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
    const release = claimAttempt(throttle, email, res);
    let row: { id: string; password_hash: string } | undefined;
    try {
      row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as typeof row;
      const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
      if (!row || !ok) {
        throttle.record(email);
        throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
      }
    } finally {
      release();
    }

    throttle.clear(email);
    setSessionCookie(res, createSession(ctx, row.id));
    res.json(meResponse(ctx.db, getUserById(ctx.db, row.id)!));
  });

  router.post('/logout', (req, res) => {
    if (req.user && req.sessionHash) destroySession(ctx, req.user.id, req.sessionHash);
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
    const release = claimAttempt(throttle, key, res);
    try {
      const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
      if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
        throttle.record(key);
        throw new HttpError(400, 'invalid_password', 'Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }
    } finally {
      release();
    }

    throttle.clear(key);
    const passwordHash = await hashPassword(input.newPassword);
    const keep = req.sessionHash ?? '';
    transaction(ctx.db, () => {
      ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      // Sign out every other device; the session making the change stays valid.
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, keep);
    });
    // Live event streams those devices still hold open stop too.
    closeSessionStreams(user.id, (sessionHash) => sessionHash !== keep);
    res.status(204).end();
  });

  return router;
}
