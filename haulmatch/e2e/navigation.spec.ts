import { expect, test } from '@playwright/test';
import { blockMapTiles, DEMO, signIn } from './helpers';

const DRIVER_TABS = [
  { name: 'Trips', url: /\/driver\/trips$/, heading: 'My trips' },
  { name: 'Alerts', url: /\/driver\/alerts$/, heading: 'Load alerts' },
  { name: 'Messages', url: /\/messages$/, heading: 'Messages' },
  { name: 'Profile', url: /\/driver\/profile$/, heading: 'Rig & preferences' },
  { name: 'Loads', url: /\/driver\/loads$/, heading: 'Load board' },
] as const;

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
  await signIn(context, DEMO.hotshot.email);
});

test.describe('on a phone', () => {
  // Both projects check the phone layout; the tab bar shows below 1024px.
  test.use({ viewport: { width: 390, height: 844 } });

  test('the bottom tab bar takes a driver to every section', async ({ page }) => {
    await page.goto('/driver/loads');
    const tabs = page.getByRole('navigation', { name: 'Main' });
    await expect(tabs).toBeVisible();
    // The bar is pinned to the bottom of the screen, within thumb reach.
    const box = await tabs.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(844 - 1);
    await expect(tabs.getByRole('link', { name: 'Loads' })).toHaveAttribute('aria-current', 'page');

    for (const tab of DRIVER_TABS) {
      await tabs.getByRole('link', { name: tab.name }).click();
      await expect(page).toHaveURL(tab.url);
      await expect(page.getByRole('heading', { name: tab.heading, exact: true }).first()).toBeVisible();
      await expect(tabs.getByRole('link', { name: tab.name })).toHaveAttribute('aria-current', 'page');
    }
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the top bar replaces the tab bar', async ({ page }) => {
    await page.goto('/driver/loads');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toHaveCount(1);
    await expect(page.locator('.tabbar')).toBeHidden();
    await nav.getByRole('link', { name: 'Trips' }).click();
    await expect(page).toHaveURL(/\/driver\/trips$/);
    await expect(nav.getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'page');
  });
});
