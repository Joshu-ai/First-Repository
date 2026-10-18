import { expect, test } from '@playwright/test';
import { blockMapTiles, chooseCity, DEMO, loadCard, openAs, signIn, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('shipper posts a hotshot load, a driver requests it, and they run it to delivery', async ({ page, context, browser }) => {
  const commodity = `Frac valve skids ${uniqueTag()}`;
  const note = 'Empty in Odessa and can load first thing.';

  // The shipper posts a load a non-CDL hotshot can haul.
  await signIn(context, DEMO.shipper.email);
  await page.goto('/shipper/loads/new');
  await expect(page.getByRole('heading', { name: 'Post a load' })).toBeVisible();
  await chooseCity(page, 'Pickup city', 'Odessa', 'TX');
  await chooseCity(page, 'Delivery city', 'Pecos', 'TX');
  await expect(page.getByText(/About \d+ mi by road/)).toBeVisible();
  await page.getByLabel('Commodity').fill(commodity);
  await page.getByLabel('Weight', { exact: true }).fill('8000');
  await page.getByLabel('Length', { exact: true }).fill('30');
  const hotshot = page.getByRole('switch', { name: 'Open to hotshot' });
  await hotshot.click();
  await expect(hotshot).toBeChecked();
  await page.getByRole('textbox', { name: 'Your rate' }).fill('900');
  await page.getByRole('button', { name: 'Post load' }).click();

  await expect(page).toHaveURL(/\/shipper\/loads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Odessa, TX → Pecos, TX' })).toBeVisible();
  await expect(page.getByText(commodity).first()).toBeVisible();

  // The demo hotshot, on their own phone, finds it ranked with a match score.
  const driver = await openAs(browser, DEMO.hotshot.email);
  const driverPage = driver.page;
  await driverPage.goto(`/driver/loads?q=${encodeURIComponent(commodity)}`);
  const card = loadCard(driverPage, commodity);
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: /^Match score \d+ out of 100/ })).toBeVisible();
  await card.getByRole('link').first().click();

  await expect(driverPage.getByRole('heading', { name: 'Odessa, TX → Pecos, TX' })).toBeVisible();
  await expect(driverPage.getByRole('heading', { name: 'How it fits your rig' })).toBeVisible();
  await driverPage.getByRole('button', { name: 'Request load' }).click();
  const dialog = driverPage.getByRole('dialog', { name: 'Request this load' });
  await dialog.getByLabel('Note for the shipper').fill(note);
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();
  await expect(driverPage.getByText('Request sent').first()).toBeVisible();
  await expect(driverPage.getByRole('button', { name: /Withdraw/ })).toBeVisible();

  // The shipper's open page shows the request live, note included, and books the driver.
  const accept = page.getByRole('button', { name: `Accept ${DEMO.hotshot.name}` });
  await expect(accept).toBeVisible();
  await expect(page.locator('article', { has: accept }).getByText(note)).toBeVisible();
  await accept.click();
  const confirm = page.getByRole('dialog', { name: `Book ${DEMO.hotshot.name}?` });
  await confirm.getByRole('button', { name: 'Accept and book' }).click();
  await expect(page.getByRole('heading', { name: 'Your driver' })).toBeVisible();

  // The driver's page flips to booked without a reload, then they run the trip.
  await expect(driverPage.getByText('You’re booked on this load', { exact: true })).toBeVisible();
  await driverPage.getByRole('button', { name: 'Picked up' }).click();
  await driverPage.getByRole('dialog', { name: 'Mark as picked up?' }).getByRole('button', { name: 'Yes, picked up' }).click();
  await expect(driverPage.getByText('On your truck', { exact: true })).toBeVisible();
  await driverPage.getByRole('button', { name: 'Delivered' }).click();
  await driverPage.getByRole('dialog', { name: 'Mark as delivered?' }).getByRole('button', { name: 'Yes, delivered' }).click();
  await expect(driverPage.getByRole('button', { name: 'Find a backhaul' })).toBeVisible();

  // The shipper sees it delivered, live.
  await expect(page.getByRole('heading', { name: 'Hauled by' })).toBeVisible();
  await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();

  await driver.context.close();
});
