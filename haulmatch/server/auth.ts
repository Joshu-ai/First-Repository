import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from '../shared/api';
import type { Role, User } from '../shared/types';
import type { AppContext } from './context';
import { forbidden, unauthorized } from './http';
import { getUserById } from './mappers';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      /** sha256 of the session token, when signed in. */
      sessionHash?: string;
    }
  }
}

const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

/** Synchronous variant for scripts (seeding). Same format as hashPassword. */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a session row and returns the raw token to put in the cookie. */
export function createSession(ctx: AppContext, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now.toISOString(), expires.toISOString());
  return token;
}

export function destroySession(ctx: AppContext, sessionHash: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.HAULMATCH_INSECURE_COOKIES !== '1',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function authenticate(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const sessionHash = hashToken(token);
      const row = ctx.db
        .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
        .get(sessionHash, ctx.now().toISOString()) as { user_id: string } | undefined;
      if (row) {
        const user = getUserById(ctx.db, row.user_id);
        if (user) {
          req.user = user;
          req.sessionHash = sessionHash;
        }
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : unauthorized());
};

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden(`Only ${role}s can do this`));
    next();
  };
}

/** For handlers that already ran requireAuth. */
export function currentUser(req: { user?: User }): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
