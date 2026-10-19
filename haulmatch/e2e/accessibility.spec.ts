// Keyboard, screen-reader and touch checks: focus that never hides under the pinned bars or falls to
// <body> after an action, forms that ask before throwing work away, a map whose pins can be told
// apart and tapped, and touch targets and layouts that hold up on small phones.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { Booking, BookLoadResponse, Load, Thread } from '../shared/types';
import { blockMapTiles, DEMO, DEMO_PASSWORD, postLoadAsShipper, signIn, uniqueTag } from './helpers';

const CSRF = { [CSRF_HEADER]: CSRF_VALUE };

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

async function requestAs(api: APIRequestContext, email: string, loadId: string): Promise<Booking> {
  const login = await api.post('/api/auth/login', { headers: CSRF, data: { email, password: DEMO_PASSWORD } });
  expect(login.ok(), `login as ${email}`).toBeTruthy();
  const res = await api.post(`/api/loads/${loadId}/book`, { headers: CSRF, data: { message: 'Can roll today' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as BookLoadResponse).booking;
}

/** A request-mode flatbed load out of Dallas that the demo semi driver fits. */
function semiLoad(api: APIRequestContext, commodity: string, pickupInHours = 2, originCityId = 'dallas-tx'): Promise<Load> {
  return postLoadAsShipper(api, {
    originCityId,
    destinationCityId: 'oklahoma-city-ok',
    commodity,
    equipmentTypes: ['FLATBED'],
    weightLbs: 20_000,
    lengthFt: 40,
    rateUsd: 1_200,
    pickupInHours,
  });
}

/** What has keyboard focus: its tag and accessible-ish name ("BODY" when focus was dropped). */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'BODY', name: '', inMain: false, inTrip: false, inRequests: false };
    return {
      tag: el.tagName,
      name: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' '),
      inMain: Boolean(el.closest('main')),
      inTrip: Boolean(el.closest('[role="tabpanel"]')),
      inRequests: Boolean(el.closest('#requests, .sh-dash')),
    };
  });
}

/** Keyboard-activates a control: focus it, press Enter. */
async function press(page: Page, locator: ReturnType<Page['locator']>) {
  await locator.focus();
  await page.keyboard.press('Enter');
}

/**
 * Tabs through the page and returns every focus stop inside <main> that the tab bar or a sticky
 * action or save bar covers, wholly or past its first line (WCAG 2.4.11).
 */
async function hiddenFocusStops(page: Page, stops = 70): Promise<string[]> {
  await page.locator('main h1').first().click();
  const hidden: string[] = [];
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('main') || el.closest('.action-bar, .drv-savebar')) return null;
      const box = el.getBoundingClientRect();
      if (box.height === 0) return null;
      const bars = [...document.querySelectorAll<HTMLElement>('.action-bar, .drv-savebar, .tabbar')]
        .filter((bar) => ['sticky', 'fixed'].includes(getComputedStyle(bar).position) && getComputedStyle(bar).display !== 'none')
        .map((bar) => bar.getBoundingClientRect())
        .filter((bar) => bar.top > box.top);
      const coverTop = Math.min(innerHeight, ...bars.map((bar) => bar.top));
      const top = Math.max(box.top, document.querySelector('.topbar')!.getBoundingClientRect().bottom);
      const visible = Math.min(box.bottom, coverTop) - top;
      const needed = Math.min(box.height, 24);
      const name = (el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.textContent || el.textContent || el.tagName).trim();
      return visible >= needed - 1 ? null : `${name.slice(0, 40)} (${Math.round(visible)}px of ${Math.round(box.height)} visible)`;
    });
    if (stop) hidden.push(stop);
  }
  return hidden;
}

test('a field that takes keyboard focus never hides under the tab bar or the sticky Post load and save bars', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(context, DEMO.shipper.email);
  await page.goto('/shipper/loads/new');
  await expect(page.getByRole('heading', { name: 'Post a load' })).toBeVisible();
  expect(await hiddenFocusStops(page)).toEqual([]);

  await signIn(context, DEMO.semi.email);
  await page.goto('/driver/profile');
  await page.getByLabel('Fuel economy').fill('7.1');
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  expect(await hiddenFocusStops(page)).toEqual([]);
});

test('keyboard focus stays on the load actions after Request load and Withdraw, not on <body>', async ({ page, context, playwright }) => {
  const api = await playwright.request.newContext();
  const load = await semiLoad(api, `Casing crossovers ${uniqueTag()}`);
  await signIn(context, DEMO.semi.email);
  await page.goto(`/driver/loads/${load.id}`);

  await press(page, page.getByRole('button', { name: 'Request load' }));
  const dialog = page.getByRole('dialog', { name: 'Request this load' });
  await press(page, dialog.getByRole('button', { name: 'Send request' }));
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Withdraw request' }).last()).toBeVisible();
  // The button that was used is gone; focus moves to the new first action instead of the top of the page.
  await expect.poll(async () => (await focused(page)).name).toBe('Message shipper');

  await press(page, page.getByRole('button', { name: 'Withdraw request' }).last());
  await press(page, page.getByRole('dialog', { name: 'Withdraw your request?' }).getByRole('button', { name: 'Withdraw', exact: true }));
  await expect(page.getByRole('button', { name: 'Request load' })).toBeVisible();
  await expect.poll(async () => (await focused(page)).name).toMatch(/^(Request load|Message shipper)$/);
});

test('withdrawing a request in My trips moves focus to the next request', async ({ page, context, playwright }) => {
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  const first = await semiLoad(api, `Mud pump liners ${tag}`, 2);
  const second = await semiLoad(api, `Mud pump valves ${tag}`, 3);
  await requestAs(api, DEMO.semi.email, first.id);
  await requestAs(api, DEMO.semi.email, second.id);

  await signIn(context, DEMO.semi.email);
  await page.goto('/driver/trips?tab=requests');
  const card = page.locator('article').filter({ hasText: first.commodity });
  await press(page, card.getByRole('button', { name: 'Withdraw request' }));
  await press(page, page.getByRole('dialog', { name: 'Withdraw your request?' }).getByRole('button', { name: 'Withdraw', exact: true }));
  await expect(card).toBeHidden();
  await expect(page.locator('article').filter({ hasText: second.commodity })).toBeVisible();
  await expect.poll(async () => focused(page)).toMatchObject({ tag: 'A', inTrip: true });
});

test('accepting a request on the dashboard keeps focus in the requests panel', async ({ page, context, playwright }) => {
  const api = await playwright.request.newContext();
  const load = await semiLoad(api, `Kelly bushings ${uniqueTag()}`);
  await requestAs(api, DEMO.semi.email, load.id);

  await signIn(context, DEMO.shipper.email);
  await page.goto('/shipper');
  const accept = page.locator('#requests button[aria-label^="Accept"]:not([disabled])').first();
  await expect(accept).toBeVisible();
  await press(page, accept);
  await press(page, page.getByRole('dialog').getByRole('button', { name: 'Accept and book' }));
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => focused(page)).toMatchObject({ inMain: true, inRequests: true });
  expect((await focused(page)).tag).not.toBe('BODY');
});

test('leaving Post load with something entered asks first: Cancel, the main nav and Back', async ({ page, context, isMobile }) => {
  await signIn(context, DEMO.shipper.email);
  await page.goto('/shipper');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Post load' }).click();
  await expect(page.getByRole('heading', { name: 'Post a load' })).toBeVisible();

  // An untouched form leaves without a question.
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/shipper$/);

  // In-app navigation, so Back stays inside the app and the page can ask.
  await nav.getByRole('link', { name: 'Post load' }).click();
  const commodity = page.getByLabel('Commodity');
  await commodity.fill('Drill pipe, 40 joints');
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });

  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(/\/shipper\/loads\/new$/);
  await expect(commodity).toHaveValue('Drill pipe, 40 joints');

  await nav.getByRole('link', { name: 'Messages' }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();

  await page.goBack();
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).toHaveURL(/\/shipper$/);

  if (isMobile) {
    // On phones Cancel is a text-weight button next to the full-width Post load.
    await page.goto('/shipper/loads/new');
    const bar = page.locator('.action-bar');
    const post = await bar.getByRole('button', { name: 'Post load' }).boundingBox();
    const cancel = await bar.getByRole('link', { name: 'Cancel' }).boundingBox();
    expect(post!.width).toBeGreaterThan(cancel!.width * 1.5);
  }
});

test('Discard on the profile asks before throwing away every change', async ({ page, context }) => {
  await signIn(context, DEMO.semi.email);
  await page.goto('/driver/profile');
  const mpg = page.getByLabel('Fuel economy');
  const before = await mpg.inputValue();
  await mpg.fill('7.3');
  const savebar = page.getByRole('region', { name: 'Unsaved changes' });
  const ask = page.getByRole('dialog', { name: 'Discard your changes?' });

  await savebar.getByRole('button', { name: 'Discard' }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(mpg).toHaveValue('7.3');

  await press(page, savebar.getByRole('button', { name: 'Discard' }));
  await press(page, ask.getByRole('button', { name: 'Discard changes' }));
  await expect(mpg).toHaveValue(before);
  await expect(savebar).toBeHidden();
  // The save bar (and the Discard button that opened the dialog) is gone: focus stays in the form.
  await expect.poll(async () => (await focused(page)).inMain).toBe(true);
});

test('the route map on a load page is a labelled group with no links hidden inside an image', async ({ page, context, playwright }) => {
  const api = await playwright.request.newContext();
  const load = await semiLoad(api, `Rig mats ${uniqueTag()}`);
  await signIn(context, DEMO.semi.email);
  await page.goto(`/driver/loads/${load.id}`);
  const map = page.getByRole('group', { name: /^Map of Dallas, TX → Oklahoma City, OK/ });
  await expect(map).toBeVisible();
  // The OpenStreetMap credit stays a working link, which an image role would hide (axe nested-interactive).
  await expect(map.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await expect(page.locator('[role="img"] a[href], [role="img"] button, [role="img"] [tabindex="0"]')).toHaveCount(0);
});

test('the load map keeps every pin tappable: the truck badge on top, close pickups grouped, popups clear of the zoom buttons', async ({ page, context, playwright }) => {
  // Pickups in Dallas (where the demo semi is empty), Irving (15 mi away) and Tyler (95 mi away),
  // found by their own tag so loads other tests post do not change the map.
  const tag = uniqueTag();
  const api = await playwright.request.newContext();
  await semiLoad(api, `Frac tree parts ${tag}`, 2, 'dallas-tx');
  await semiLoad(api, `Frac tree parts ${tag}`, 2, 'irving-tx');
  await semiLoad(api, `Frac tree parts ${tag}`, 2, 'tyler-tx');
  await signIn(context, DEMO.semi.email);
  await page.goto(`/driver/loads?view=map&q=${encodeURIComponent(tag)}`);
  const map = page.locator('.map--loads');
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
  await map.scrollIntoViewIfNeeded();

  // The driver's own spot is a badge drawn above the pickup pin in the same city.
  const truck = map.locator('.leaflet-marker-icon[title^="You:"]');
  await expect(truck.locator('.map-badge')).toBeVisible();
  const truckOnTop = await truck.evaluate((marker) => {
    const box = marker.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && marker.contains(hit));
  });
  expect(truckOnTop).toBe(true);

  // No two pickup pins sit closer than a fingertip.
  const closest = await map.locator('.leaflet-marker-icon:has(.map-pin--origin)').evaluateAll((pins) => {
    const centres = pins.map((pin) => {
      const box = pin.querySelector('.map-pin')!.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    let min = Infinity;
    for (let i = 0; i < centres.length; i++) {
      for (let j = i + 1; j < centres.length; j++) min = Math.min(min, Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y));
    }
    return min;
  });
  expect(closest).toBeGreaterThanOrEqual(36);

  // Dallas and Irving share a ringed pin at this zoom; tapping it zooms in to each city.
  const cluster = map.locator('.leaflet-marker-icon:has(.map-pin--cluster)').first();
  await expect(cluster).toHaveAttribute('title', /and \d+ more pickup cit(y|ies) close by/);
  const firstCity = ((await cluster.getAttribute('title')) ?? '').split(' and ')[0];
  await cluster.click();
  await expect(map.locator(`.leaflet-marker-icon[title^="${firstCity}:"]`)).toBeVisible();
  await expect(map).toBeInViewport();

  // A city's popup opens clear of the zoom buttons.
  await map.locator(`.leaflet-marker-icon[title^="${firstCity}:"]`).click();
  const popup = map.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await page.waitForTimeout(400); // the popup pans into view
  const [pop, zoom] = await Promise.all([popup.boundingBox(), map.locator('.leaflet-control-zoom').boundingBox()]);
  const overlaps = !(zoom!.x + zoom!.width <= pop!.x || pop!.x + pop!.width <= zoom!.x || zoom!.y + zoom!.height <= pop!.y || pop!.y + pop!.height <= zoom!.y);
  expect(overlaps).toBe(false);
});

test('an open conversation on a short phone keeps room for the messages', async ({ page, context }) => {
  await signIn(context, DEMO.hotshot.email);
  const threads = (await (await context.request.get('/api/threads')).json()) as Thread[];
  const thread = threads.find((t) => t.counterpart.name === DEMO.shipper.name) ?? threads[0];
  expect(thread, 'the demo hotshot has a conversation').toBeTruthy();

  // An iPhone SE in Safari with its bars showing.
  await page.setViewportSize({ width: 375, height: 548 });
  await page.goto(`/messages/${thread.loadId}/${thread.driverId}`);
  const log = page.locator('.cm-log');
  await expect(log).toBeVisible();
  await expect(page.getByRole('link', { name: 'View load' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeHidden();
  expect(await log.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(260);

  // A normal phone keeps the tab bar and the full load card.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.cm-context__facts').getByText('Pickup')).toBeVisible();
});

test('the city field clear button is a full 44px target on touch screens', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'touch screens only (pointer: coarse)');
  await signIn(context, DEMO.semi.email);
  await page.goto('/driver/profile');
  const clear = page.getByRole('button', { name: 'Clear Where are you empty?' });
  await expect(clear).toBeVisible();
  const box = (await clear.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The city name stops short of the button.
  const input = page.getByRole('combobox', { name: 'Where are you empty?' });
  const padding = await input.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
  expect(padding).toBeGreaterThanOrEqual(box.width);
});
