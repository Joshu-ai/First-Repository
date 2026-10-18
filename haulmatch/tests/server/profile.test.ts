import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCity } from '../../shared/cities';
import { EQUIPMENT_CODES } from '../../shared/equipment';
import { roadMiles } from '../../shared/geo';
import { estimateRate } from '../../shared/rates';
import type { BookingStatus, DriverProfile, DriverSummary } from '../../shared/types';
import { client, createTestApp, insertLoad, seedUser, signUp, type TestApp } from '../helpers';

function insertBooking(t: TestApp, loadId: string, driverId: string, status: BookingStatus = 'pending'): string {
  const id = randomUUID();
  const now = t.clock.now().toISOString();
  t.db
    .prepare(
      `INSERT INTO bookings (id, load_id, driver_id, status, offer_rate_usd, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '', ?, ?)`,
    )
    .run(id, loadId, driverId, status, now, now);
  return id;
}

function insertMessage(t: TestApp, loadId: string, driverId: string, senderId: string, body = 'Is this still open?'): void {
  t.db
    .prepare('INSERT INTO messages (id, load_id, driver_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), loadId, driverId, senderId, body, t.clock.now().toISOString());
}

describe('GET /api/drivers/me/profile', () => {
  it('returns the signed-in driver profile', async () => {
    const t = createTestApp();
    const { c, user } = seedUser(t, { role: 'driver', driver: { homeCityId: 'midland-tx' } });
    const res = await c.get('/api/drivers/me/profile');
    expect(res.status).toBe(200);
    const profile = res.body as DriverProfile;
    expect(profile).toMatchObject({
      userId: user.id,
      driverClass: 'hotshot',
      equipmentTypes: ['HS_GOOSENECK'],
      profileComplete: true,
    });
    expect(profile.currentLocation).toMatchObject({ cityId: 'houston-tx', city: 'Houston', state: 'TX' });
    expect(profile.homeBase).toMatchObject({ cityId: 'midland-tx', state: 'TX' });
  });

  it('is 403 for shippers and 401 when signed out', async () => {
    const t = createTestApp();
    const { c } = seedUser(t, { role: 'shipper' });
    const shipper = await c.get('/api/drivers/me/profile');
    expect(shipper.status).toBe(403);
    expect(shipper.body.error.code).toBe('forbidden');
    expect((await client(t.app).get('/api/drivers/me/profile')).status).toBe(401);
  });
});

describe('PUT /api/drivers/me/profile', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('completes a freshly registered hotshot profile', async () => {
    const { c, me } = await signUp(t.app, { role: 'driver', driverClass: 'hotshot' });
    expect(me.driverProfile?.profileComplete).toBe(false);
    t.clock.advance(1);

    const res = await c.put('/api/drivers/me/profile', {
      equipmentTypes: ['HS_GOOSENECK', 'HS_DOVETAIL', 'HS_GOOSENECK'],
      trailerLengthFt: 40,
      maxPayloadLbs: 14_000,
      truckDescription: '  2022 Ram 3500 dually + 40ft PJ gooseneck  ',
      mcNumber: '1234567',
      dotNumber: '3456789',
      currentCityId: 'odessa-tx',
      homeCityId: 'midland-tx',
      availableFrom: '2026-10-19T06:00:00-05:00',
      maxDeadheadMiles: 250,
      minRatePerMile: 1.75,
      preferredStates: ['tx', 'NM', 'TX'],
      avoidStates: ['CA'],
      mpg: 10.5,
      fuelPricePerGallon: 3.95,
      teamDriver: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: me.user.id,
      driverClass: 'hotshot',
      equipmentTypes: ['HS_GOOSENECK', 'HS_DOVETAIL'],
      trailerLengthFt: 40,
      maxPayloadLbs: 14_000,
      truckDescription: '2022 Ram 3500 dually + 40ft PJ gooseneck',
      mcNumber: '1234567',
      dotNumber: '3456789',
      availableFrom: '2026-10-19T11:00:00.000Z',
      maxDeadheadMiles: 250,
      minRatePerMile: 1.75,
      preferredStates: ['TX', 'NM'],
      avoidStates: ['CA'],
      mpg: 10.5,
      fuelPricePerGallon: 3.95,
      profileComplete: true,
      updatedAt: t.clock.now().toISOString(),
    });
    expect(res.body.currentLocation).toMatchObject({ cityId: 'odessa-tx', city: 'Odessa', state: 'TX' });
    expect(res.body.homeBase).toMatchObject({ cityId: 'midland-tx' });

    // A partial update leaves everything else alone.
    const partial = await c.put('/api/drivers/me/profile', { available: false });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ ...res.body, available: false });
    expect((await c.get('/api/drivers/me/profile')).body).toEqual(partial.body);
  });

  it('does not let drivers write rating, completed loads or another user id', async () => {
    const { c, user } = seedUser(t, { role: 'driver' });
    const res = await c.put('/api/drivers/me/profile', { rating: 5, completedLoads: 999, userId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: user.id, rating: 4.8, completedLoads: 12 });
  });

  it('rejects equipment from the other driver class', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const res = await c.put('/api/drivers/me/profile', { equipmentTypes: ['HS_GOOSENECK', 'DRY_VAN'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'equipmentTypes' })]);
    expect(res.body.error.message).toContain('DRY_VAN');
  });

  it('checks equipment against the new class when switching classes', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    // Still holding hotshot equipment, so a bare class switch is rejected.
    expect((await c.put('/api/drivers/me/profile', { driverClass: 'semi' })).status).toBe(400);
    expect((await c.put('/api/drivers/me/profile', { driverClass: 'semi', equipmentTypes: ['HS_GOOSENECK'] })).status).toBe(
      400,
    );
    const ok = await c.put('/api/drivers/me/profile', {
      driverClass: 'semi',
      equipmentTypes: ['DRY_VAN', 'REEFER'],
      hasCdl: true,
      cdlClass: 'A',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ driverClass: 'semi', equipmentTypes: ['DRY_VAN', 'REEFER'], hasCdl: true, cdlClass: 'A' });
  });

  it('allows a class switch when no equipment is on file yet', async () => {
    const { c } = await signUp(t.app, { role: 'driver', driverClass: 'hotshot' });
    const res = await c.put('/api/drivers/me/profile', { driverClass: 'semi' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ driverClass: 'semi', equipmentTypes: [] });
  });

  it('drops CDL class and CDL-only endorsements when the driver has no CDL', async () => {
    const { c } = seedUser(t, { role: 'driver', driver: { driverClass: 'semi', equipmentTypes: ['TANKER'] } });
    const withCdl = await c.put('/api/drivers/me/profile', {
      hasCdl: true,
      cdlClass: 'A',
      endorsements: ['hazmat', 'tanker', 'doubles_triples', 'twic', 'hazmat'],
    });
    expect(withCdl.status).toBe(200);
    expect(withCdl.body.endorsements).toEqual(['hazmat', 'tanker', 'doubles_triples', 'twic']);

    const noCdl = await c.put('/api/drivers/me/profile', { hasCdl: false });
    expect(noCdl.status).toBe(200);
    expect(noCdl.body).toMatchObject({ hasCdl: false, cdlClass: null, endorsements: ['twic'] });

    // Sending them again without a CDL still strips them.
    const again = await c.put('/api/drivers/me/profile', { cdlClass: 'B', endorsements: ['hazmat', 'twic'] });
    expect(again.body).toMatchObject({ hasCdl: false, cdlClass: null, endorsements: ['twic'] });
  });

  it('accepts null and blank MC/DOT numbers and clears cities with null', async () => {
    const { c } = seedUser(t, { role: 'driver', driver: { homeCityId: 'midland-tx' } });
    const res = await c.put('/api/drivers/me/profile', {
      mcNumber: '',
      dotNumber: null,
      currentCityId: null,
      homeCityId: null,
      availableFrom: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mcNumber: null,
      dotNumber: null,
      currentLocation: null,
      homeBase: null,
      availableFrom: null,
      profileComplete: false,
    });
  });

  it.each([
    ['trailer too short', { trailerLengthFt: 7.9 }],
    ['trailer too long', { trailerLengthFt: 61 }],
    ['payload too low', { maxPayloadLbs: 499 }],
    ['payload too high', { maxPayloadLbs: 80_001 }],
    ['fractional payload', { maxPayloadLbs: 10_000.5 }],
    ['long truck description', { truckDescription: 't'.repeat(121) }],
    ['MC number with letters', { mcNumber: 'MC12345' }],
    ['MC number over 12 digits', { mcNumber: '1234567890123' }],
    ['DOT number over 10 digits', { dotNumber: '12345678901' }],
    ['unknown CDL class', { cdlClass: 'C' }],
    ['unknown endorsement', { endorsements: ['forklift'] }],
    ['unknown equipment code', { equipmentTypes: ['SPACESHIP'] }],
    ['unknown current city', { currentCityId: 'atlantis-xx' }],
    ['unknown home city', { homeCityId: 'nowhere-tx' }],
    ['invalid preferred state', { preferredStates: ['TX', 'ZZ'] }],
    ['invalid avoid state', { avoidStates: ['Texas'] }],
    ['bad availableFrom', { availableFrom: 'next tuesday' }],
    ['negative deadhead', { maxDeadheadMiles: -1 }],
    ['deadhead over 1000', { maxDeadheadMiles: 1001 }],
    ['min rate over 20', { minRatePerMile: 20.01 }],
    ['negative min rate', { minRatePerMile: -0.5 }],
    ['mpg too low', { mpg: 1.9 }],
    ['mpg too high', { mpg: 40.1 }],
    ['fuel price too low', { fuelPricePerGallon: 0.99 }],
    ['fuel price too high', { fuelPricePerGallon: 15.01 }],
    ['string for a number', { trailerLengthFt: '40' }],
    ['string for a boolean', { available: 'yes' }],
    ['unknown driver class', { driverClass: 'box_truck' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { c } = seedUser(t, { role: 'driver' });
    const before = (await c.get('/api/drivers/me/profile')).body;
    const res = await c.put('/api/drivers/me/profile', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect((await c.get('/api/drivers/me/profile')).body).toEqual(before);
  });

  it('accepts the range limits', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    const low = await c.put('/api/drivers/me/profile', {
      trailerLengthFt: 8,
      maxPayloadLbs: 500,
      maxDeadheadMiles: 0,
      minRatePerMile: 0,
      mpg: 2,
      fuelPricePerGallon: 1,
      mcNumber: '123456789012',
      dotNumber: '1234567890',
      truckDescription: 'x'.repeat(120),
    });
    expect(low.status).toBe(200);
    const high = await c.put('/api/drivers/me/profile', {
      trailerLengthFt: 60,
      maxPayloadLbs: 80_000,
      maxDeadheadMiles: 1000,
      minRatePerMile: 20,
      mpg: 40,
      fuelPricePerGallon: 15,
    });
    expect(high.status).toBe(200);
  });

  it('is 403 for shippers, 401 signed out and 403 without the CSRF header', async () => {
    const { c: shipper } = seedUser(t, { role: 'shipper' });
    expect((await shipper.put('/api/drivers/me/profile', { available: false })).status).toBe(403);
    expect((await client(t.app).put('/api/drivers/me/profile', { available: false })).status).toBe(401);
    const { c: driver } = seedUser(t, { role: 'driver' });
    const res = await driver.agent.put('/api/drivers/me/profile').send({ available: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
});

describe('PATCH /api/drivers/me/location', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('moves the driver and updates availability ("empty in Tulsa")', async () => {
    const { c } = seedUser(t, { role: 'driver', driver: { available: false } });
    t.clock.advance(2);
    const res = await c.patch('/api/drivers/me/location', {
      cityId: 'tulsa-ok',
      available: true,
      availableFrom: '2026-10-18T15:00:00Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.currentLocation).toMatchObject({ cityId: 'tulsa-ok', city: 'Tulsa', state: 'OK' });
    expect(res.body).toMatchObject({
      available: true,
      availableFrom: '2026-10-18T15:00:00.000Z',
      updatedAt: t.clock.now().toISOString(),
    });
  });

  it('keeps availability when only the city is sent', async () => {
    const { c } = seedUser(t, { role: 'driver', driver: { available: false, availableFrom: '2026-10-20T12:00:00.000Z' } });
    const res = await c.patch('/api/drivers/me/location', { cityId: 'dallas-tx' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, availableFrom: '2026-10-20T12:00:00.000Z' });
    expect(res.body.currentLocation.cityId).toBe('dallas-tx');
  });

  it('validates the city', async () => {
    const { c } = seedUser(t, { role: 'driver' });
    expect((await c.patch('/api/drivers/me/location', {})).status).toBe(400);
    expect((await c.patch('/api/drivers/me/location', { cityId: null })).status).toBe(400);
    expect((await c.patch('/api/drivers/me/location', { cityId: 'atlantis-xx' })).status).toBe(400);
    expect((await c.patch('/api/drivers/me/location', { cityId: 'dallas-tx', availableFrom: 'soon' })).status).toBe(400);
  });

  it('is driver-only', async () => {
    const { c } = seedUser(t, { role: 'shipper' });
    expect((await c.patch('/api/drivers/me/location', { cityId: 'dallas-tx' })).status).toBe(403);
  });
});

describe('GET /api/drivers/me/stats', () => {
  it('counts active, pending and delivered work for this driver only', async () => {
    const t = createTestApp();
    const { user: shipper } = seedUser(t, { role: 'shipper' });
    const { c, user: driver } = seedUser(t, { role: 'driver' });
    const { user: other } = seedUser(t, { role: 'driver' });

    insertLoad(t, shipper.id, { status: 'booked', bookedDriverId: driver.id, rateUsd: 1_200 });
    insertLoad(t, shipper.id, { status: 'in_transit', bookedDriverId: driver.id, rateUsd: 900 });
    insertLoad(t, shipper.id, { status: 'delivered', bookedDriverId: driver.id, rateUsd: 1_500 });
    insertLoad(t, shipper.id, { status: 'delivered', bookedDriverId: driver.id, rateUsd: 2_250 });
    insertLoad(t, shipper.id, { status: 'cancelled', bookedDriverId: driver.id, rateUsd: 5_000 });
    insertLoad(t, shipper.id, { status: 'delivered', bookedDriverId: other.id, rateUsd: 9_999 });
    const open1 = insertLoad(t, shipper.id);
    const open2 = insertLoad(t, shipper.id);
    insertBooking(t, open1.id, driver.id, 'pending');
    insertBooking(t, open2.id, driver.id, 'pending');
    insertBooking(t, open2.id, other.id, 'pending');
    insertBooking(t, insertLoad(t, shipper.id).id, driver.id, 'declined');

    const res = await c.get('/api/drivers/me/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeLoads: 2, pendingRequests: 2, completedLoads: 2, earnedUsd: 3_750 });
  });

  it('is all zeros for a new driver and 403 for shippers', async () => {
    const t = createTestApp();
    const { c } = await signUp(t.app, { role: 'driver', driverClass: 'semi' });
    expect((await c.get('/api/drivers/me/stats')).body).toEqual({
      activeLoads: 0,
      pendingRequests: 0,
      completedLoads: 0,
      earnedUsd: 0,
    });
    const { c: shipper } = seedUser(t, { role: 'shipper' });
    expect((await shipper.get('/api/drivers/me/stats')).status).toBe(403);
  });
});

describe('GET /api/drivers/:id', () => {
  let t: TestApp;
  let driver: ReturnType<typeof seedUser>;
  beforeEach(() => {
    t = createTestApp();
    driver = seedUser(t, { role: 'driver', name: 'Jake Morales', company: 'Morales Hotshot', phone: '432-555-0199' });
  });

  const view = async (viewer: { c: ReturnType<typeof seedUser>['c'] }) => {
    const res = await viewer.c.get(`/api/drivers/${driver.user.id}`);
    expect(res.status).toBe(200);
    return res.body as DriverSummary;
  };

  it('returns the public summary without private account fields', async () => {
    const summary = await view(seedUser(t, { role: 'shipper' }));
    expect(summary).toMatchObject({
      userId: driver.user.id,
      name: 'Jake Morales',
      company: 'Morales Hotshot',
      phone: null,
      driverClass: 'hotshot',
      equipmentTypes: ['HS_GOOSENECK'],
      trailerLengthFt: 40,
      maxPayloadLbs: 16_500,
      hasCdl: false,
      endorsements: [],
      rating: 4.8,
      completedLoads: 12,
      available: true,
    });
    expect(summary.currentLocation).toMatchObject({ cityId: 'houston-tx' });
    expect(summary).not.toHaveProperty('email');
    expect(JSON.stringify(summary)).not.toMatch(/scrypt|password/i);
  });

  it('shows the phone to the driver themself', async () => {
    expect((await view(driver)).phone).toBe('432-555-0199');
  });

  it('hides the phone from other drivers, even ones on the same load', async () => {
    const { user: shipper } = seedUser(t, { role: 'shipper' });
    const other = seedUser(t, { role: 'driver' });
    const load = insertLoad(t, shipper.id);
    insertBooking(t, load.id, driver.user.id);
    insertBooking(t, load.id, other.user.id);
    expect((await view(other)).phone).toBeNull();
  });

  it('shows the phone to a shipper with a booking request from the driver, whatever its outcome', async () => {
    const shipper = seedUser(t, { role: 'shipper' });
    const load = insertLoad(t, shipper.user.id);
    expect((await view(shipper)).phone).toBeNull();
    const bookingId = insertBooking(t, load.id, driver.user.id, 'pending');
    expect((await view(shipper)).phone).toBe('432-555-0199');
    t.db.prepare(`UPDATE bookings SET status = 'declined' WHERE id = ?`).run(bookingId);
    expect((await view(shipper)).phone).toBe('432-555-0199');
  });

  it('shows the phone to the shipper whose load the driver is booked on', async () => {
    const shipper = seedUser(t, { role: 'shipper' });
    insertLoad(t, shipper.user.id, { status: 'in_transit', bookedDriverId: driver.user.id });
    expect((await view(shipper)).phone).toBe('432-555-0199');
  });

  it('shows the phone to a shipper once the driver has written in a thread on their load', async () => {
    const shipper = seedUser(t, { role: 'shipper' });
    const load = insertLoad(t, shipper.user.id);
    // A thread the shipper started alone does not unlock the phone.
    insertMessage(t, load.id, driver.user.id, shipper.user.id, 'Can you take this one?');
    expect((await view(shipper)).phone).toBeNull();
    insertMessage(t, load.id, driver.user.id, driver.user.id, 'Yes, I can be there at 6.');
    expect((await view(shipper)).phone).toBe('432-555-0199');
  });

  it('does not show the phone to a shipper whose relationship is on another shipper load', async () => {
    const owner = seedUser(t, { role: 'shipper' });
    const outsider = seedUser(t, { role: 'shipper' });
    const load = insertLoad(t, owner.user.id, { status: 'booked', bookedDriverId: driver.user.id });
    insertBooking(t, load.id, driver.user.id, 'accepted');
    insertMessage(t, load.id, driver.user.id, driver.user.id);
    insertLoad(t, outsider.user.id);
    expect((await view(owner)).phone).toBe('432-555-0199');
    expect((await view(outsider)).phone).toBeNull();
  });

  it('is 404 for shippers and unknown ids, 401 when signed out', async () => {
    const shipper = seedUser(t, { role: 'shipper' });
    const shipperView = await driver.c.get(`/api/drivers/${shipper.user.id}`);
    expect(shipperView.status).toBe(404);
    expect(shipperView.body.error.code).toBe('not_found');
    expect((await driver.c.get(`/api/drivers/${randomUUID()}`)).status).toBe(404);
    expect((await client(t.app).get(`/api/drivers/${driver.user.id}`)).status).toBe(401);
  });
});

describe('reference data', () => {
  let t: TestApp;
  beforeEach(() => {
    t = createTestApp();
  });

  it('searches cities without signing in, 8 results by default', async () => {
    const c = client(t.app);
    const res = await c.get('/api/cities?q=dallas');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'dallas-tx', name: 'Dallas', state: 'TX' });
    expect(res.body.length).toBeLessThanOrEqual(8);

    const san = await c.get('/api/cities?q=san');
    expect(san.body).toHaveLength(8);
    expect((await c.get('/api/cities?q=san&limit=3')).body).toHaveLength(3);
    expect((await c.get('/api/cities?q=san&limit=25')).body).toHaveLength(25);
    expect((await c.get('/api/cities?q=odessa tx')).body[0].id).toBe('odessa-tx');
  });

  it('returns no cities for an empty query and validates limit', async () => {
    const c = client(t.app);
    expect((await c.get('/api/cities')).body).toEqual([]);
    expect((await c.get('/api/cities?q=')).body).toEqual([]);
    for (const limit of ['0', '26', 'abc', '2.5']) {
      const res = await c.get(`/api/cities?q=san&limit=${limit}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('looks up one city by id', async () => {
    const c = client(t.app);
    const res = await c.get('/api/cities/houston-tx');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(getCity('houston-tx'));
    const missing = await c.get('/api/cities/atlantis-xx');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
  });

  it('serves equipment, driver classes and states', async () => {
    const res = await client(t.app).get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body.equipment.map((e: { code: string }) => e.code)).toEqual(EQUIPMENT_CODES);
    expect(res.body.equipment.find((e: { code: string }) => e.code === 'HS_GOOSENECK')).toMatchObject({
      driverClass: 'hotshot',
      shortLabel: 'Gooseneck',
    });
    expect(res.body.driverClasses.map((d: { driverClass: string }) => d.driverClass)).toEqual(['hotshot', 'semi']);
    expect(res.body.states).toHaveLength(51);
    expect(res.body.states).toContainEqual({ code: 'TX', name: 'Texas' });
  });

  it('estimates a lane rate from road miles', async () => {
    const c = client(t.app);
    const miles = roadMiles(getCity('houston-tx')!, getCity('odessa-tx')!);
    const res = await c.get('/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx&equipment=HS_GOOSENECK,FLATBED');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(estimateRate(miles, ['HS_GOOSENECK', 'FLATBED']));
    expect(res.body.miles).toBe(miles);

    const noEquipment = await c.get('/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx');
    expect(noEquipment.status).toBe(200);
    expect(noEquipment.body).toEqual(estimateRate(miles, []));
  });

  it.each([
    ['unknown origin', 'originCityId=atlantis-xx&destinationCityId=odessa-tx'],
    ['unknown destination', 'originCityId=houston-tx&destinationCityId=nowhere-zz'],
    ['missing origin', 'destinationCityId=odessa-tx'],
    ['missing destination', 'originCityId=houston-tx'],
    ['bad equipment code', 'originCityId=houston-tx&destinationCityId=odessa-tx&equipment=FLATBED,HOVERCRAFT'],
  ])('rejects a rate estimate with %s', async (_label, query) => {
    const res = await client(t.app).get(`/api/rates/estimate?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
