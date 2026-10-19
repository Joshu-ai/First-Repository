// Load pages show the load in the URL and nothing from the one before it, and the shipper's page
// says what can and cannot be done: a closed pickup window, a request that no longer fits, and an
// edit that cancels the waiting requests.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { Booking, BookLoadResponse, Load, RecommendedDriver, ShipperStats } from '../shared/types';
import { blockMapTiles, chooseCity, DEMO, DEMO_PASSWORD, postLoadAsShipper, signIn, uniqueTag } from './helpers';

const CSRF = { [CSRF_HEADER]: CSRF_VALUE };
const HOUR_MS = 3_600_000;

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

async function loginApi(api: APIRequestContext, email: string): Promise<void> {
  const res = await api.post('/api/auth/login', { headers: CSRF, data: { email, password: DEMO_PASSWORD } });
  expect(res.ok(), `login as ${email}`).toBeTruthy();
}

async function requestLoad(api: APIRequestContext, email: string, loadId: string): Promise<Booking> {
  await loginApi(api, email);
  const res = await api.post(`/api/loads/${loadId}/book`, { headers: CSRF, data: { message: 'Can roll today' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as BookLoadResponse).booking;
}

test('opening another load from a load page never shows (or books) the previous one', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const first = await postLoadAsShipper(api, {
    originCityId: 'dallas-tx',
    destinationCityId: 'oklahoma-city-ok',
    commodity: `Pipe racks ${tag}`,
    equipmentTypes: ['FLATBED'],
    weightLbs: 20_000,
    lengthFt: 40,
    rateUsd: 1_100,
    bookingMode: 'instant',
  });
  const backhaul = await postLoadAsShipper(api, {
    originCityId: 'oklahoma-city-ok',
    destinationCityId: 'tulsa-ok',
    commodity: `Drill collars ${tag}`,
    equipmentTypes: ['FLATBED'],
    weightLbs: 20_000,
    lengthFt: 40,
    rateUsd: 1_500,
    pickupInHours: 8,
  });

  await signIn(context, DEMO.semi.email);
  const bookCalls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/book')) bookCalls.push(r.url());
  });
  await page.goto(`/driver/loads/${first.id}`);
  await expect(page.getByRole('heading', { name: 'Dallas, TX → Oklahoma City, OK' })).toBeVisible();
  const link = page.locator(`#backhauls a[href="/driver/loads/${backhaul.id}"]`);
  const showAll = page.getByRole('button', { name: /^Show all \d+ backhauls/ });
  await expect(link.or(showAll).first()).toBeVisible();
  if (!(await link.isVisible())) await showAll.click();

  // The backhaul is cancelled before the driver taps it, so it no longer opens for them.
  expect((await api.post(`/api/loads/${backhaul.id}/cancel`, { headers: CSRF })).ok()).toBeTruthy();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/driver/loads/${backhaul.id}$`));
  await expect(page.getByText('This load isn’t on the board anymore')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dallas, TX → Oklahoma City, OK' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Book now|Request load)$/ })).toHaveCount(0);
  expect(bookCalls).toEqual([]);
  await api.dispose();
});

test('the shipper load page starts fresh for each load: an invite on one is not shown on the next', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const spec = {
    originCityId: 'dallas-tx',
    destinationCityId: 'houston-tx',
    equipmentTypes: ['FLATBED' as const],
    weightLbs: 20_000,
    lengthFt: 40,
    rateUsd: 1_200,
  };
  const a = await postLoadAsShipper(api, { ...spec, commodity: `Tubing A ${tag}` });
  const b = await postLoadAsShipper(api, { ...spec, commodity: `Tubing B ${tag}` });
  const recommended = (await (await api.get(`/api/loads/${a.id}/recommended-drivers`)).json()) as RecommendedDriver[];
  const invitee = recommended.find((r) => r.driver.name !== DEMO.semi.name)?.driver;
  test.skip(!invitee, 'Needs a recommended driver other than the requester');

  await signIn(context, DEMO.shipper.email);
  await page.goto(`/shipper/loads/${a.id}`);
  const showAll = page.getByRole('button', { name: /^Show all \d+ drivers/ });
  await expect(page.getByRole('heading', { name: 'Recommended drivers' })).toBeVisible();
  if (await showAll.isVisible()) await showAll.click();
  await page.getByRole('button', { name: `Invite ${invitee!.name} to book` }).click();
  await page.getByRole('dialog', { name: `Invite ${invitee!.name} to book` }).getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('button', { name: `Invite sent to ${invitee!.name}` })).toBeVisible();

  // A driver requests load B; the shipper follows the toast from A's page straight to B's.
  const driverApi = await playwright.request.newContext();
  await requestLoad(driverApi, DEMO.semi.email, b.id);
  await page.locator('.toast__link').first().click();
  await expect(page).toHaveURL(new RegExp(`/shipper/loads/${b.id}`));
  await expect(page.getByText(`Tubing B ${tag}`).first()).toBeVisible();
  if (await showAll.isVisible()) await showAll.click();
  await expect(page.getByRole('button', { name: `Invite ${invitee!.name} to book` })).toBeEnabled();
  await expect(page.getByRole('button', { name: `Invite sent to ${invitee!.name}` })).toHaveCount(0);
  await api.dispose();
  await driverApi.dispose();
});

test('an open load past its pickup window says so, and offers a new window or a cancel', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  await loginApi(api, DEMO.shipper.email);
  const now = Date.now();
  const created = await api.post('/api/loads', {
    headers: CSRF,
    data: {
      originCityId: 'dallas-tx',
      destinationCityId: 'houston-tx',
      commodity: `Late pallets ${tag}`,
      equipmentTypes: ['FLATBED'],
      weightLbs: 20_000,
      lengthFt: 40,
      rateUsd: 1_000,
      bookingMode: 'request',
      referenceNumber: `LATE-${tag}`,
      pickupStart: new Date(now - HOUR_MS).toISOString(),
      pickupEnd: new Date(now + 2_000).toISOString(),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const load = (await created.json()) as Load;
  await page.waitForTimeout(2_500);

  await signIn(context, DEMO.shipper.email);
  const stats = (await (await context.request.get('/api/shipper/stats')).json()) as ShipperStats;
  expect(stats.expired).toBeGreaterThanOrEqual(1);
  await page.goto('/shipper?tab=open');
  // The Open tab still lists it, and its count includes it.
  await expect(page.getByRole('tab', { name: /^Open/ })).toContainText(String(stats.open + stats.expired));
  // Newest first, so it is on the first page; the compact card shows the reference, not the commodity.
  const card = page.locator('article.load-card').filter({ hasText: `Ref LATE-${tag}` });
  await expect(card.getByText('Pickup window passed: edit or cancel')).toBeVisible();
  await card.getByRole('link', { name: /^View / }).click();

  await expect(page).toHaveURL(new RegExp(`/shipper/loads/${load.id}$`));
  const banner = page.locator('.alert').filter({ hasText: 'Pickup window passed: edit or cancel' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('drivers can’t find, book or be invited to it');
  await expect(page.getByRole('link', { name: 'Set a new window' })).toBeVisible();
  // Invites are refused past the window, so no drivers are offered.
  await expect(page.getByRole('heading', { name: 'Recommended drivers' })).toHaveCount(0);
  await api.dispose();
});

test('a request that no longer fits the load cannot be accepted', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'dallas-tx',
    destinationCityId: 'houston-tx',
    commodity: `Steel coils ${tag}`,
    equipmentTypes: ['FLATBED'],
    weightLbs: 24_000,
    lengthFt: 40,
    rateUsd: 1_250,
  });
  const driverApi = await playwright.request.newContext();
  await requestLoad(driverApi, DEMO.semi.email, load.id);
  // The shipper adds freight after the request: more than Marcus's 47,000 lb payload.
  const patched = await api.patch(`/api/loads/${load.id}`, { headers: CSRF, data: { weightLbs: 47_500 } });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  await signIn(context, DEMO.shipper.email);
  await page.goto(`/shipper/loads/${load.id}`);
  await expect(page.getByRole('button', { name: `Accept ${DEMO.semi.name}` })).toBeDisabled();
  await expect(page.getByText('Doesn’t fit this load as it is now').first()).toBeVisible();
  await expect(page.getByRole('button', { name: `Decline ${DEMO.semi.name}` })).toBeEnabled();
  await api.dispose();
  await driverApi.dispose();
});

test('editing the lane of a load with a waiting request warns, and asks before cancelling it', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'dallas-tx',
    destinationCityId: 'houston-tx',
    commodity: `Valve crates ${tag}`,
    equipmentTypes: ['FLATBED'],
    weightLbs: 18_000,
    lengthFt: 32,
    rateUsd: 1_150,
  });
  const driverApi = await playwright.request.newContext();
  const booking = await requestLoad(driverApi, DEMO.semi.email, load.id);
  const bookingStatus = async () =>
    ((await (await driverApi.get('/api/bookings')).json()) as Booking[]).find((b) => b.id === booking.id)?.status;

  await signIn(context, DEMO.shipper.email);
  await page.goto(`/shipper/loads/${load.id}/edit`);
  await expect(page.getByText('1 driver asked for this load')).toBeVisible();
  // A new commodity or rate keeps the request.
  await page.getByLabel('Commodity').fill(`Valve crates ${tag} (2 more)`);
  await expect(page.getByText('Saving cancels 1 waiting request')).toHaveCount(0);

  await chooseCity(page, 'Delivery city', 'Austin', 'TX');
  await expect(page.getByText('Saving cancels 1 waiting request')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).first().click();
  const confirm = page.getByRole('dialog', { name: 'Cancel 1 waiting request?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(confirm).toBeHidden();
  expect(await bookingStatus()).toBe('pending');

  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await confirm.getByRole('button', { name: 'Save and cancel requests' }).click();
  await expect(page).toHaveURL(new RegExp(`/shipper/loads/${load.id}$`));
  await expect(page.getByRole('heading', { name: 'Dallas, TX → Austin, TX' })).toBeVisible();
  expect(await bookingStatus()).toBe('cancelled');
  await api.dispose();
  await driverApi.dispose();
});
