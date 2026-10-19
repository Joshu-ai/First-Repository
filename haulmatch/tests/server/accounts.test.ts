import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../shared/api';
import { DEFAULT_FUEL_PRICE_PER_GALLON, DRIVER_CLASSES } from '../../shared/equipment';
import type { MeResponse } from '../../shared/types';
import { verifyPassword } from '../../server/auth';
import { client, createTestApp, seedUser, signUp, type TestApp } from '../helpers';

// Wrap the real verifyPassword so tests can prove unknown emails still pay for a hash comparison.
vi.mock('../../server/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/auth')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const PASSWORD = 'correct-horse-battery';

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!session) throw new Error('no session cookie set');
  return session.split(';')[0];
}

function register(t: TestApp, body: Record<string, unknown>) {
  return client(t.app).post('/api/auth/register', {
    email: 'new.driver@test.example',
    password: PASSWORD,
    name: 'Jake Morales',
    role: 'driver',
    driverClass: 'hotshot',
    ...body,
  });
}

describe('POST /api/auth/register', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('creates a hotshot driver with non-CDL class defaults and signs them in', async () => {
    const c = client(t.app);
    const res = await c.post('/api/auth/register', {
      email: 'jake@test.example',
      password: PASSWORD,
      name: 'Jake Morales',
      role: 'driver',
      driverClass: 'hotshot',
      phone: '(432) 555-0199',
    });
    expect(res.status).toBe(201);
    const me = res.body as MeResponse;
    expect(me.user).toMatchObject({
      email: 'jake@test.example',
      name: 'Jake Morales',
      role: 'driver',
      company: null,
      phone: '(432) 555-0199',
      createdAt: t.clock.now().toISOString(),
    });
    expect(me.driverProfile).toMatchObject({
      userId: me.user.id,
      driverClass: 'hotshot',
      equipmentTypes: [],
      trailerLengthFt: 40,
      maxPayloadLbs: 10_000,
      hasCdl: false,
      cdlClass: null,
      endorsements: [],
      maxDeadheadMiles: 150,
      minRatePerMile: DRIVER_CLASSES.hotshot.defaultMinRatePerMile,
      mpg: 11,
      fuelPricePerGallon: DEFAULT_FUEL_PRICE_PER_GALLON,
      available: true,
      rating: 0,
      completedLoads: 0,
      currentLocation: null,
      homeBase: null,
      profileComplete: false,
    });

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((h) => h.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const meRes = await c.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.id).toBe(me.user.id);
  });

  it('gives semi drivers CDL-A defaults', async () => {
    const res = await register(t, { email: 'semi@test.example', driverClass: 'semi' });
    expect(res.status).toBe(201);
    expect(res.body.driverProfile).toMatchObject({
      driverClass: 'semi',
      equipmentTypes: [],
      trailerLengthFt: 53,
      maxPayloadLbs: 45_000,
      hasCdl: true,
      cdlClass: 'A',
      maxDeadheadMiles: 200,
      minRatePerMile: DRIVER_CLASSES.semi.defaultMinRatePerMile,
      mpg: 6.5,
      fuelPricePerGallon: DEFAULT_FUEL_PRICE_PER_GALLON,
      available: true,
      profileComplete: false,
    });
  });

  it('creates shippers without a driver profile and ignores driverClass', async () => {
    const res = await register(t, {
      email: 'dispatch@test.example',
      role: 'shipper',
      company: 'Lone Star Oilfield Supply',
      driverClass: 'semi',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'shipper', company: 'Lone Star Oilfield Supply' });
    expect(res.body.driverProfile).toBeNull();
    const row = t.db.prepare('SELECT COUNT(*) AS n FROM driver_profiles WHERE user_id = ?').get(res.body.user.id) as {
      n: number;
    };
    expect(row.n).toBe(0);
  });

  it('never returns the password hash', async () => {
    const res = await register(t, {});
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
    const stored = t.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(res.body.user.id) as {
      password_hash: string;
    };
    expect(stored.password_hash).toMatch(/^scrypt:/);
    expect(stored.password_hash).not.toContain(PASSWORD);
  });

  it('normalises the email and rejects duplicates in any case with 409 email_taken', async () => {
    const first = await register(t, { email: '  Mixed.Case@Example.COM ' });
    expect(first.status).toBe(201);
    expect(first.body.user.email).toBe('mixed.case@example.com');

    const dup = await register(t, { email: 'MIXED.case@example.com', role: 'shipper' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
  });

  it('turns blank company and phone into null', async () => {
    const res = await register(t, { role: 'shipper', company: '   ', phone: '' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ company: null, phone: null });
  });

  it.each([
    ['a malformed email', { email: 'not-an-email' }, 'email'],
    ['a short password', { password: 'short' }, 'password'],
    ['a password over 200 characters', { password: 'x'.repeat(201) }, 'password'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a name over 80 characters', { name: 'n'.repeat(81) }, 'name'],
    ['an unknown role', { role: 'admin' }, 'role'],
    ['a driver without a class', { driverClass: undefined }, 'driverClass'],
    ['an unknown driver class', { driverClass: 'box_truck' }, 'driverClass'],
    ['a junk phone number', { phone: 'call me' }, 'phone'],
  ])('rejects %s with 400', async (_label, body, path) => {
    const res = await register(t, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it('requires the CSRF header', async () => {
    const res = await client(t.app).agent.post('/api/auth/register').send({
      email: 'csrf@test.example',
      password: PASSWORD,
      name: 'No Header',
      role: 'shipper',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});

describe('POST /api/auth/login', () => {
  let t: TestApp;
  const email = 'login.driver@test.example';
  beforeEach(async () => {
    t = createTestApp();
    await register(t, { email });
    vi.mocked(verifyPassword).mockClear();
  });

  const login = (body: Record<string, unknown>) => client(t.app).post('/api/auth/login', body);

  it('signs in with the right password and sets a session cookie', async () => {
    const c = client(t.app);
    const res = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.driverProfile.driverClass).toBe('hotshot');
    expect(sessionCookieFrom(res)).toMatch(new RegExp(`^${SESSION_COOKIE}=.+`));
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('accepts the email in any case and with surrounding spaces', async () => {
    const res = await login({ email: '  LOGIN.Driver@TEST.example ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const wrong = await login({ email, password: 'wrong-password' });
    const unknown = await login({ email: 'nobody@test.example', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('invalid_credentials');
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('still runs a hash comparison for unknown emails', async () => {
    await login({ email: 'nobody@test.example', password: 'whatever-password' });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    const [password, stored] = vi.mocked(verifyPassword).mock.calls[0];
    expect(password).toBe('whatever-password');
    expect(stored).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('rejects a missing email or password with 400', async () => {
    expect((await login({ email })).status).toBe(400);
    expect((await login({ password: PASSWORD })).status).toBe(400);
    expect((await login({ email: '', password: PASSWORD })).status).toBe(400);
  });

  it('requires the CSRF header', async () => {
    const res = await client(t.app).agent.post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it(
    'locks an email for 15 minutes after 10 failures, even with the right password',
    async () => {
      for (let i = 0; i < 10; i += 1) {
        const res = await login({ email, password: `wrong-${i}` });
        expect(res.status).toBe(401);
      }
      const blocked = await login({ email, password: PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('too_many_attempts');
      expect(blocked.headers['retry-after']).toBe(String(15 * 60));

      // The lock is per email: other accounts can still sign in.
      await register(t, { email: 'other@test.example', role: 'shipper' });
      expect((await login({ email: 'other@test.example', password: PASSWORD })).status).toBe(200);

      // Still blocked just before the failures age out, then open again.
      t.clock.advance(14.5 / 60);
      const almost = await login({ email, password: PASSWORD });
      expect(almost.status).toBe(429);
      expect(almost.headers['retry-after']).toBe('30');
      t.clock.advance(0.5 / 60);
      expect((await login({ email, password: PASSWORD })).status).toBe(200);
    },
    30_000,
  );

  it(
    'counts failures case-insensitively and for unknown emails too',
    async () => {
      for (let i = 0; i < 10; i += 1) {
        const res = await login({ email: i % 2 ? 'Ghost@Test.Example' : 'ghost@test.example', password: 'nope-nope' });
        expect(res.status).toBe(401);
      }
      const res = await login({ email: 'GHOST@test.example', password: 'nope-nope' });
      expect(res.status).toBe(429);
    },
    30_000,
  );

  it(
    'clears the failure count after a successful login',
    async () => {
      for (let i = 0; i < 9; i += 1) expect((await login({ email, password: 'wrong-password' })).status).toBe(401);
      expect((await login({ email, password: PASSWORD })).status).toBe(200);
      for (let i = 0; i < 10; i += 1) expect((await login({ email, password: 'wrong-password' })).status).toBe(401);
      expect((await login({ email, password: PASSWORD })).status).toBe(429);
    },
    30_000,
  );

  it(
    'only counts failures inside the 15 minute window',
    async () => {
      for (let i = 0; i < 9; i += 1) expect((await login({ email, password: 'wrong-password' })).status).toBe(401);
      t.clock.advance(0.26);
      // The nine old failures have aged out, so ten more are allowed before the lock.
      for (let i = 0; i < 9; i += 1) expect((await login({ email, password: 'wrong-password' })).status).toBe(401);
      expect((await login({ email, password: PASSWORD })).status).toBe(200);
    },
    30_000,
  );
});

describe('session endpoints', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('GET /me is 401 when signed out', async () => {
    const res = await client(t.app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('GET /me returns the shipper with a null driver profile', async () => {
    const { c, user } = seedUser(t, { role: 'shipper', company: 'Gulf Coast Steel' });
    const res = await c.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user, driverProfile: null });
  });

  it('logout deletes the session and clears the cookie', async () => {
    const c = client(t.app);
    const reg = await register(t, { email: 'bye@test.example' });
    const cookie = sessionCookieFrom(reg);
    const signedIn = client(t.app, cookie);
    expect((await signedIn.get('/api/auth/me')).status).toBe(200);

    const res = await signedIn.post('/api/auth/logout');
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((h) => h.startsWith(`${SESSION_COOKIE}=`));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    // The old token no longer works anywhere.
    expect((await client(t.app, cookie).get('/api/auth/me')).status).toBe(401);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(reg.body.user.id)).toEqual({ n: 0 });
    expect((await c.post('/api/auth/logout')).status).toBe(204);
  });

  it('logout requires the CSRF header', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.agent.post('/api/auth/logout');
    expect(res.status).toBe(403);
  });

  it('sessions expire after 30 days', async () => {
    const { c } = await signUp(t.app, { role: 'shipper' });
    t.clock.advance(24 * 30 + 1);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('PATCH /api/auth/me', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('updates name, company and phone, keeping fields that are not sent', async () => {
    const { c, user } = seedUser(t, { role: 'shipper', company: 'Old Co', phone: '555-111-2222' });
    const res = await c.patch('/api/auth/me', { name: '  Dana Ortiz ', company: 'Permian Freight Brokers' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      name: 'Dana Ortiz',
      company: 'Permian Freight Brokers',
      phone: '555-111-2222',
      email: user.email,
    });
    expect(res.body.driverProfile).toBeNull();
  });

  it('clears company and phone with null or blank strings', async () => {
    const { c } = seedUser(t, { role: 'driver', company: 'Morales Hotshot LLC' });
    const res = await c.patch('/api/auth/me', { company: '', phone: null });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ company: null, phone: null });
    expect(res.body.driverProfile.driverClass).toBe('hotshot');
  });

  it('ignores attempts to change email or role', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    const res = await c.patch('/api/auth/me', { email: 'hijack@test.example', role: 'shipper' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: user.email, role: 'driver' });
  });

  it('validates the fields', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    expect((await c.patch('/api/auth/me', { name: '' })).status).toBe(400);
    expect((await c.patch('/api/auth/me', { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await c.patch('/api/auth/me', { company: 'c'.repeat(121) })).status).toBe(400);
    expect((await c.patch('/api/auth/me', { phone: 'not a phone' })).status).toBe(400);
  });

  it('is 401 when signed out', async () => {
    expect((await client(t.app).patch('/api/auth/me', { name: 'Nobody' })).status).toBe(401);
  });
});

describe('POST /api/auth/password', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('changes the password, signs out other devices and keeps this one', async () => {
    const email = 'pw@test.example';
    const reg = await register(t, { email });
    const thisDevice = client(t.app, sessionCookieFrom(reg));
    const otherLogin = await client(t.app).post('/api/auth/login', { email, password: PASSWORD });
    const otherDevice = client(t.app, sessionCookieFrom(otherLogin));

    const res = await thisDevice.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-pass' });
    expect(res.status).toBe(204);

    expect((await thisDevice.get('/api/auth/me')).status).toBe(200);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await client(t.app).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await client(t.app).post('/api/auth/login', { email, password: 'a-brand-new-pass' })).status).toBe(200);
  });

  it('rejects a wrong current password with 400 and a field error', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.post('/api/auth/password', { currentPassword: 'not-the-password', newPassword: 'a-brand-new-pass' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_password');
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'currentPassword' })]);
  });

  it('validates the new password length', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'newPassword' })]);
  });

  it(
    'is throttled together with login so a stolen session cannot guess the password',
    async () => {
      const { c } = seedUser(t, { role: 'shipper' });
      for (let i = 0; i < 10; i += 1) {
        const res = await c.post('/api/auth/password', { currentPassword: `guess-${i}-x`, newPassword: 'a-brand-new-pass' });
        expect(res.status).toBe(400);
      }
      const res = await c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-pass' });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('too_many_attempts');
    },
    30_000,
  );

  it('is 401 when signed out and 403 without the CSRF header', async () => {
    expect((await client(t.app).post('/api/auth/password', { currentPassword: 'x', newPassword: 'yyyyyyyy' })).status).toBe(
      401,
    );
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.agent.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-pass' });
    expect(res.status).toBe(403);
  });
});
