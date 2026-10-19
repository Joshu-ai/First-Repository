// The load board and city boxes keep what the driver picked: a "Pickup near" city survives Apply and
// alert edits, Enter picks the city that was typed, and Load more never skips a load.
import { expect, test } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { LoadListResponse, SavedSearch } from '../shared/types';
import { blockMapTiles, DEMO, DEMO_PASSWORD, loadCard, postLoadAsShipper, signIn, uniqueTag } from './helpers';

const CSRF = { [CSRF_HEADER]: CSRF_VALUE };

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('the desktop filter panel keeps "Pickup near" after Apply, so the next Apply does not drop it', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'The filter sidebar is a desktop layout; phones use the filter sheet.');
  await signIn(context, DEMO.semi.email);
  await page.goto('/driver/loads');
  const panel = page.getByRole('complementary', { name: 'Filters' });
  const near = panel.getByRole('combobox', { name: 'Pickup near' });

  await near.fill('Midland');
  await panel.getByRole('option').filter({ hasText: 'Midland' }).filter({ hasText: 'TX' }).first().click();
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/originCityId=midland-tx/);
  // The panel remounts for the new search and still shows the city it was applied with.
  await expect(near).toHaveValue('Midland, TX');
  await expect(panel.getByLabel('Pickup radius')).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Apply' })).toBeDisabled();

  await panel.getByLabel('Min posted rate').fill('2');
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/minRatePerMile=2/);
  expect(new URL(page.url()).searchParams.get('originCityId')).toBe('midland-tx');

  // Switching cities: the panel shows the new one, and the next Apply keeps it.
  await near.fill('Abilene');
  await panel.getByRole('option').filter({ hasText: 'Abilene' }).filter({ hasText: 'TX' }).first().click();
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/originCityId=abilene-tx/);
  await expect(near).toHaveValue('Abilene, TX');
  await panel.getByLabel('Max weight').fill('20000');
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/maxWeightLbs=20000/);
  expect(new URL(page.url()).searchParams.get('originCityId')).toBe('abilene-tx');
});

test('editing an alert keeps the city it watches', async ({ page, context }) => {
  await signIn(context, DEMO.semi.email);
  const name = `Tulsa runs ${uniqueTag()}`;
  const filters = { originCityId: 'tulsa-ok', originRadiusMiles: 250, equipment: ['FLATBED'] };
  const created = await context.request.post('/api/saved-searches', { headers: CSRF, data: { name, filters } });
  expect(created.status()).toBe(201);
  const alert = (await created.json()) as SavedSearch;

  await page.goto('/driver/alerts');
  await page.getByRole('button', { name: `Rename or edit ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit alert' });
  await expect(dialog.getByRole('combobox', { name: 'Pickup near' })).toHaveValue('Tulsa, OK');
  await dialog.getByLabel('Alert name').fill(`${name} (renamed)`);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  const saved = ((await (await context.request.get('/api/saved-searches')).json()) as SavedSearch[]).find((s) => s.id === alert.id);
  expect(saved?.name).toBe(`${name} (renamed)`);
  expect(saved?.filters).toMatchObject(filters);
  await context.request.delete(`/api/saved-searches/${alert.id}`, { headers: CSRF });
});

test('Enter in a city box picks the city typed, not a suggestion left from a shorter search', async ({ page, context }) => {
  await signIn(context, DEMO.shipper.email);
  await page.goto('/shipper/loads/new');
  const box = page.getByRole('combobox', { name: 'Delivery city' });
  await box.click();
  await box.pressSequentially('San', { delay: 30 });
  const list = page.getByRole('listbox', { name: 'Delivery city suggestions' });
  await expect(list.getByRole('option').first()).toContainText('San Antonio');

  // The search for the full name is slow; Enter lands while "San" (San Antonio first) is still listed.
  await page.route(/\/api\/cities\?q=San(\+|%20)Diego/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await box.pressSequentially(' Diego', { delay: 20 });
  await box.press('Enter');
  await expect(box).toHaveValue('San Diego, CA');
  // Enter did not submit the half-filled form.
  await expect(page.getByText('Check the highlighted fields.')).toHaveCount(0);
});

test('Load more shows every load still on the board after one on page one leaves it', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const posted = [];
  for (let i = 0; i < 22; i += 1) {
    posted.push(
      await postLoadAsShipper(api, {
        originCityId: 'dallas-tx',
        destinationCityId: 'houston-tx',
        // Zero-padded so no name is part of another ("#1" is in "#12").
        commodity: `Rebar bundle ${tag} #${String(i + 1).padStart(2, '0')}`,
        equipmentTypes: ['FLATBED'],
        weightLbs: 20_000,
        lengthFt: 40,
        rateUsd: 1_000 + i * 10,
      }),
    );
  }

  await signIn(context, DEMO.semi.email);
  await page.goto(`/driver/loads?q=${encodeURIComponent(tag)}`);
  const cards = page.locator('article.load-card');
  await expect(cards).toHaveCount(20);
  const more = page.getByRole('button', { name: /^Load more · 20 of 22/ });
  await expect(more).toBeVisible();

  // The shipper cancels the 4th card's load. This driver never asked about it, so no event arrives.
  const fourth = (await cards.nth(3).locator('.load-card__commodity').innerText()).trim();
  const gone = posted.find((l) => l.commodity === fourth)!;
  expect((await api.post(`/api/loads/${gone.id}/cancel`, { headers: CSRF })).ok()).toBeTruthy();

  await more.click();
  await expect(cards).toHaveCount(21);
  for (const load of posted) {
    if (load.id === gone.id) await expect(loadCard(page, load.commodity)).toHaveCount(0);
    else await expect(loadCard(page, load.commodity)).toHaveCount(1);
  }
  await expect(page.getByText('That’s every load on the board for this search.')).toBeVisible();

  // Same set the API has.
  const login = await api.post('/api/auth/login', { headers: CSRF, data: { email: DEMO.semi.email, password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const board = (await (await api.get(`/api/loads?q=${encodeURIComponent(tag)}&limit=50`)).json()) as LoadListResponse;
  expect(board.total).toBe(21);
  await api.dispose();
});
