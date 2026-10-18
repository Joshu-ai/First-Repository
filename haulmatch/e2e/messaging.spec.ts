import { expect, test } from '@playwright/test';
import { blockMapTiles, DEMO, openAs, postLoadAsShipper, signIn, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

test('a driver and a shipper message about a load and each side gets it live', async ({ page, context, browser, playwright }) => {
  const tag = uniqueTag();
  const commodity = `Pump jack parts ${tag}`;
  const question = `Can I pick up at 7 AM? (${tag})`;
  const answer = `Yes, gate opens at 6:30. Ask for Luis. (${tag})`;
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'odessa-tx',
    destinationCityId: 'lubbock-tx',
    commodity,
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 7_500,
    lengthFt: 28,
    rateUsd: 850,
  });
  await api.dispose();

  // The shipper sits on the Messages page.
  await signIn(context, DEMO.shipper.email);
  await page.goto('/messages');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();

  // The driver starts a conversation from the load page.
  const driver = await openAs(browser, DEMO.hotshot.email);
  const driverPage = driver.page;
  await driverPage.goto(`/driver/loads/${load.id}`);
  await driverPage.getByRole('link', { name: 'Message shipper' }).first().click();
  await expect(driverPage).toHaveURL(new RegExp(`/messages/${load.id}/${driver.me.user.id}$`));
  const driverBox = driverPage.getByRole('textbox', { name: /^Message / });
  await driverBox.fill(question);
  await driverPage.getByRole('button', { name: 'Send message' }).click();
  await expect(driverPage.getByRole('log').getByText(question)).toBeVisible();
  await expect(driverBox).toHaveValue('');

  // It shows up in the shipper's list without a reload; they open it and reply.
  const thread = page.getByRole('link').filter({ hasText: question });
  await expect(thread).toBeVisible();
  await thread.click();
  await expect(page.getByRole('log').getByText(question)).toBeVisible();
  await page.getByRole('textbox', { name: /^Message / }).fill(answer);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log').getByText(answer)).toBeVisible();

  // The driver's open conversation receives the reply live.
  await expect(driverPage.getByRole('log').getByText(answer)).toBeVisible();

  await driver.context.close();
});
