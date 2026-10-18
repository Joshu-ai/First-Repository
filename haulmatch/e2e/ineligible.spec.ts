import { expect, test } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import { blockMapTiles, DEMO, loadCard, postLoadAsShipper, signIn, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('a load too heavy for the non-CDL hotshot is hidden, explained and not bookable', async ({ page, context, playwright }) => {
  const commodity = `Drill collars ${uniqueTag()}`;
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'odessa-tx',
    destinationCityId: 'midland-tx',
    commodity,
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 12_000,
    lengthFt: 30,
    rateUsd: 600,
    bookingMode: 'instant',
  });
  await api.dispose();
  await signIn(context, DEMO.hotshot.email);

  // The board leaves it out by default...
  await page.goto(`/driver/loads?q=${encodeURIComponent(commodity)}`);
  await expect(page.getByText('No loads match these filters')).toBeVisible();

  // ...and shows it, marked as not a fit with the reasons, when asked for loads the driver can't take.
  await page.goto(`/driver/loads?q=${encodeURIComponent(commodity)}&includeIneligible=true`);
  const card = loadCard(page, commodity);
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: 'Not a fit for your rig' })).toBeVisible();
  await expect(card.getByText('Too heavy: 12,000 lbs over your 10,000 lbs limit')).toBeVisible();
  await card.getByRole('link').first().click();

  // The load page explains every failed check and offers no way to book.
  await expect(page).toHaveURL(new RegExp(`/driver/loads/${load.id}$`));
  await expect(page.getByText('This load doesn’t fit your rig', { exact: true })).toBeVisible();
  const reasons = page.locator('.drv-failed');
  await expect(reasons.getByText('Too heavy: 12,000 lbs over your 10,000 lbs limit')).toBeVisible();
  await expect(reasons.getByText('Over 10,000 lbs: needs a CDL (26,001+ lbs combination)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request load' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Message shipper' }).first()).toBeVisible();

  // The API refuses it too, naming the failed checks.
  const res = await context.request.post(`/api/loads/${load.id}/book`, { headers: { [CSRF_HEADER]: CSRF_VALUE }, data: {} });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error.code).toBe('not_eligible');
  expect((body.error.details as { key: string }[]).map((c) => c.key).sort()).toEqual(['cdl', 'weight']);
});
