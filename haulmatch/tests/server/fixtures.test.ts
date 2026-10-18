import { describe, expect, it } from 'vitest';
import { createTestApp, insertLoad, seedUser } from '../helpers';

describe('test fixtures', () => {
  it('seedUser signs in through a real session and insertLoad round-trips', async () => {
    const t = createTestApp();
    const { c, user } = seedUser(t, { role: 'shipper' });
    const load = insertLoad(t, user.id);
    expect(load.origin.cityId).toBe('houston-tx');
    expect(load.miles).toBeGreaterThan(400);
    // Health route proves the app is up; CSRF guard rejects mutations without the header.
    const health = await c.get('/api/health');
    expect(health.status).toBe(200);
    const res = await c.agent.post('/api/auth/logout');
    expect(res.status).toBe(403);
  });
});
