import { expect, test } from '@playwright/test';
import { EQUIPMENT } from '../shared/equipment';
import type { RateEstimate } from '../shared/types';
import { blockMapTiles, chooseCity, DEMO, postLoadAsShipper, signIn, uniqueTag } from './helpers';

test.beforeEach(async ({ context }) => {
  await blockMapTiles(context);
});

const money = (usd: number) => `$${usd.toLocaleString('en-US')}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where the benchmarks and the default diesel price come from (MARKET_SNAPSHOT). */
const MARKET_LINE = 'Market data: DAT national averages, Sept 2026 · diesel $6.29';

test('the post-load estimate prices freight too big for a hotshot on the semi equipment', async ({ page, context }) => {
  await signIn(context, DEMO.shipper.email);
  const estimate = async (query: string): Promise<RateEstimate> => {
    const res = await context.request.get(`/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx&${query}`);
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as RateEstimate;
  };
  const flatbed = await estimate('equipment=FLATBED');
  const gooseneck = await estimate('equipment=HS_GOOSENECK');
  expect(gooseneck.suggestedUsd).toBeLessThan(flatbed.suggestedUsd);

  await page.goto('/shipper/loads/new');
  await chooseCity(page, 'Pickup city', 'Houston', 'TX');
  await chooseCity(page, 'Delivery city', 'Odessa', 'TX');
  const flatbedOption = page.getByRole('checkbox', { name: new RegExp(`^${escape(EQUIPMENT.FLATBED.label)}`) });
  await page.getByText(EQUIPMENT.FLATBED.label, { exact: true }).click();
  await expect(flatbedOption).toBeChecked();
  await page.getByLabel('Weight', { exact: true }).fill('8000');
  await page.getByLabel('Length', { exact: true }).fill('30');
  const hotshot = page.getByRole('switch', { name: 'Open to hotshot' });
  await hotshot.click();
  await expect(hotshot).toBeChecked();

  // Light freight a hotshot can carry: priced on the cheaper hotshot rig.
  const useSuggested = page.getByRole('button', { name: /^Use suggested/ });
  await expect(useSuggested).toHaveText(`Use suggested ${money(gooseneck.suggestedUsd)}`);
  await expect(page.getByText(gooseneck.basis, { exact: false })).toBeVisible();
  await expect(page.getByText(MARKET_LINE, { exact: true })).toBeVisible();

  // Too heavy for any hotshot: the estimate moves to the flatbed price the semi drivers will expect.
  await page.getByLabel('Weight', { exact: true }).fill('42000');
  await expect(useSuggested).toHaveText(`Use suggested ${money(flatbed.suggestedUsd)}`);
  await expect(page.getByText(flatbed.basis, { exact: false })).toBeVisible();
  await expect(page.getByText(flatbed.basis, { exact: false })).toContainText('DAT national spot averages, Sept 2026');
});

test('the driver money panel cites the market data, and the diesel field offers the national average', async ({ page, context, playwright }) => {
  const api = await playwright.request.newContext();
  const load = await postLoadAsShipper(api, {
    originCityId: 'dallas-tx',
    destinationCityId: 'waco-tx',
    commodity: `Rig mats ${uniqueTag()}`,
    equipmentTypes: ['FLATBED'],
    weightLbs: 18_000,
    lengthFt: 40,
    rateUsd: 700,
  });
  await api.dispose();
  await signIn(context, DEMO.semi.email);

  await page.goto(`/driver/loads/${load.id}`);
  await expect(page.getByRole('heading', { name: 'The money' })).toBeVisible();
  await expect(page.getByText(MARKET_LINE, { exact: true })).toBeVisible();

  await page.goto('/driver/profile');
  const diesel = page.getByRole('textbox', { name: /^Diesel price/ });
  await expect(page.getByText(/The national average was \$6\.29 in Sept 2026\./)).toBeVisible();
  await diesel.fill('5.10');
  await page.getByRole('button', { name: 'Use $6.29' }).click();
  await expect(diesel).toHaveValue('6.29');
  await expect(page.getByRole('button', { name: 'Use $6.29' })).toHaveCount(0);
});
