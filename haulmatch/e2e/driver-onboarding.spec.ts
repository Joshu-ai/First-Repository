import { expect, test } from '@playwright/test';
import { blockMapTiles, chooseCity, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('a new hotshot driver signs up, sets up the rig and lands on ranked matches', async ({ page }) => {
  const tag = uniqueTag();

  await page.goto('/');
  await page.getByRole('link', { name: /Sign up/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Create your free account' })).toBeVisible();

  await page.getByText('I run hotshot').click();
  await page.getByLabel('Your name').fill(`Test Driver ${tag}`);
  await page.getByLabel('Email').fill(`hotshot-${tag}@e2e.haulmatch.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Step 1: rig type, already hotshot from the signup choice.
  await expect(page).toHaveURL(/\/driver\/setup$/);
  await expect(page.getByRole('heading', { name: 'Set up your rig' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Hotshot/ })).toBeChecked();
  await page.getByRole('button', { name: 'Next: Equipment' }).click();

  // Step 2: equipment is required.
  await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible();
  await page.getByRole('button', { name: 'Next: Capacity' }).click();
  await expect(page.getByText('Pick at least one trailer you can pull')).toBeVisible();
  await page.getByText('Hotshot gooseneck flatbed').click();
  await page.getByRole('button', { name: 'Next: Capacity' }).click();

  // Step 3: capacity is prefilled for a non-CDL gooseneck.
  await expect(page.getByRole('heading', { name: 'Capacity' })).toBeVisible();
  await expect(page.getByLabel('Deck length')).toHaveValue('40');
  await expect(page.getByLabel('Max payload')).toHaveValue('10,000');
  await page.getByRole('button', { name: 'Next: Location' }).click();

  // Step 4: where the driver is empty.
  await expect(page.getByRole('heading', { name: 'Location' })).toBeVisible();
  await chooseCity(page, 'Where are you empty?', 'Odessa', 'TX');
  await page.getByRole('button', { name: 'Next: Preferences' }).click();

  // Step 5: defaults are fine.
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish and see loads' }).click();

  await expect(page).toHaveURL(/\/driver\/loads/);
  await expect(page.getByRole('heading', { name: 'Load board' })).toBeVisible();
  await expect(page.getByText(/\d+ loads? fits? your rig/)).toBeVisible();
  await expect(page.getByText('Odessa, TX').first()).toBeVisible();

  // Every card on the board is a match with a score, best first.
  const scores = page.locator('article.load-card').getByRole('img', { name: /^Match score \d+ out of 100/ });
  await expect(scores.first()).toBeVisible();
  const labels = await scores.evaluateAll((els) => els.slice(0, 5).map((el) => el.getAttribute('aria-label') ?? ''));
  const values = labels.map((label) => Number(/Match score (\d+)/.exec(label)?.[1]));
  expect(values.length).toBeGreaterThan(1);
  expect(values).toEqual([...values].sort((a, b) => b - a));
});
