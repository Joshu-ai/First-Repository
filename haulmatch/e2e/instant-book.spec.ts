import { expect, test } from '@playwright/test';
import { blockMapTiles, loadCard, postLoadAsShipper, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('the demo semi driver instant-books a load in one tap', async ({ page, playwright }) => {
  const commodity = `Structural steel ${uniqueTag()}`;
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'dallas-tx',
    destinationCityId: 'houston-tx',
    commodity,
    equipmentTypes: ['FLATBED', 'STEP_DECK'],
    weightLbs: 24_000,
    lengthFt: 40,
    rateUsd: 1_150,
    bookingMode: 'instant',
  });

  // Sign in with the demo button on the login page.
  await page.goto('/login');
  await page.getByRole('button', { name: /Semi driver/ }).click();
  await expect(page).toHaveURL(/\/driver\/loads/);

  await page.goto(`/driver/loads?q=${encodeURIComponent(commodity)}`);
  const card = loadCard(page, commodity);
  await expect(card).toBeVisible();
  await expect(card.getByText('Instant book')).toBeVisible();
  await card.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/driver/loads/${load.id}$`));

  await page.getByRole('button', { name: 'Book now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book this load' });
  await expect(dialog.getByText('It’s yours the moment you confirm')).toBeVisible();
  await dialog.getByRole('button', { name: 'Book now · $1,150' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('You’re booked on this load', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Picked up' })).toBeVisible();

  // It is now on the driver's trips and off the board.
  await page.goto('/driver/trips');
  await expect(page.getByText(commodity).first()).toBeVisible();
  const status = await api.get(`/api/loads/${load.id}`);
  expect((await status.json()).load.status).toBe('booked');
  await page.goto(`/driver/loads?q=${encodeURIComponent(commodity)}`);
  await expect(page.getByText('No loads match these filters')).toBeVisible();
  await api.dispose();
});
