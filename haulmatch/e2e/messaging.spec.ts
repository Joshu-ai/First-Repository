import { expect, test, type APIRequestContext } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { Load, MeResponse, Message, Thread } from '../shared/types';
import { blockMapTiles, DEMO, DEMO_PASSWORD, openAs, postLoadAsShipper, signIn, uniqueTag } from './helpers';

const CSRF = { [CSRF_HEADER]: CSRF_VALUE };

async function loginApi(api: APIRequestContext, email: string): Promise<MeResponse> {
  const res = await api.post('/api/auth/login', { headers: CSRF, data: { email, password: DEMO_PASSWORD } });
  expect(res.ok(), `login as ${email}`).toBeTruthy();
  return (await res.json()) as MeResponse;
}

async function hotshotLoad(api: APIRequestContext, commodity: string): Promise<Load> {
  return postLoadAsShipper(api, {
    originCityId: 'odessa-tx',
    destinationCityId: 'midland-tx',
    commodity,
    equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
    weightLbs: 6_000,
    lengthFt: 24,
    rateUsd: 650,
  });
}

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

test('opening a conversation marks it read on the server, which a plain read no longer does', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const load = await hotshotLoad(api, `Mud pumps ${tag}`);
  const driver = await playwright.request.newContext();
  const driverMe = await loginApi(driver, DEMO.hotshot.email);
  const sent = await driver.post(`/api/loads/${load.id}/messages`, { headers: CSRF, data: { body: `Still open? (${tag})` } });
  expect(sent.status()).toBe(201);

  await signIn(context, DEMO.shipper.email);
  const unread = async () =>
    ((await (await context.request.get('/api/threads')).json()) as Thread[]).find(
      (t) => t.loadId === load.id && t.driverId === driverMe.user.id,
    )?.unreadCount;
  expect(await unread()).toBe(1);

  const markedRead = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/loads/${load.id}/messages/read`));
  await page.goto(`/messages/${load.id}/${driverMe.user.id}`);
  await expect(page.getByRole('log').getByText(`Still open? (${tag})`)).toBeVisible();
  await markedRead;
  await expect.poll(unread).toBe(0);
  await api.dispose();
  await driver.dispose();
});

test('a long conversation loads its earlier messages on request', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const load = await hotshotLoad(api, `Flowback tanks ${tag}`);
  await api.dispose();
  const me = await signIn(context, DEMO.hotshot.email);

  // The server pages threads 100 at a time; stand in a 102-message thread for the real one.
  const start = Date.parse('2026-10-01T12:00:00Z');
  const message = (n: number): Message => ({
    id: `m${String(n).padStart(3, '0')}`,
    loadId: load.id,
    driverId: me.user.id,
    senderId: n % 2 ? me.user.id : load.shipperId,
    senderName: n % 2 ? me.user.name : 'Dana Whitfield',
    body: `Update ${n} (${tag})`,
    createdAt: new Date(start + n * 60_000).toISOString(),
    readAt: null,
  });
  const all = Array.from({ length: 102 }, (_, i) => message(i + 1));
  const pages: string[] = [];
  await page.route(new RegExp(`/api/loads/${load.id}/messages\\?`), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url());
    pages.push(url.search);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const before = url.searchParams.get('before');
    const end = before ? all.findIndex((m) => m.id === before) : all.length;
    await route.fulfill({ json: all.slice(Math.max(0, end - limit), end) });
  });

  await page.goto(`/messages/${load.id}/${me.user.id}`);
  const log = page.getByRole('log');
  await expect(log.getByText(`Update 102 (${tag})`)).toBeVisible();
  await expect(log.getByText(`Update 2 (${tag})`, { exact: true })).toHaveCount(0);
  await log.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(log.getByText(`Update 1 (${tag})`, { exact: true })).toBeAttached();
  await expect(log.getByText(`Update 2 (${tag})`, { exact: true })).toBeAttached();
  await expect(log.getByText('Start of the conversation')).toBeVisible();
  await expect(log.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  await expect(log.locator('.cm-msg')).toHaveCount(102);
  expect(pages).toEqual(['?limit=100', '?before=m003&limit=100']);
});

test('sending too fast shows the reason and keeps the unsent message', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const load = await hotshotLoad(api, `Frac iron ${tag}`);
  await api.dispose();
  const me = await signIn(context, DEMO.hotshot.email);
  await page.route(new RegExp(`/api/loads/${load.id}/messages$`), async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 429,
      headers: { 'Retry-After': '42' },
      json: { error: { code: 'too_many_messages', message: 'You’re sending messages too fast. Wait a minute, then try again.' } },
    });
  });

  await page.goto(`/messages/${load.id}/${me.user.id}`);
  const box = page.getByRole('textbox', { name: /^Message / });
  const text = `Running 20 minutes behind (${tag})`;
  await box.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('You’re sending messages too fast. Wait a minute, then try again.')).toBeVisible();
  await expect(box).toHaveValue(text);
  await expect(page.getByRole('log').getByText(text)).toHaveCount(0);
});
