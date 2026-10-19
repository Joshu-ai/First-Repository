import { expect, test } from '@playwright/test';
import { EQUIPMENT } from '../shared/equipment';
import type { RateEstimate } from '../shared/types';
import { chooseCity, DEMO, signIn } from './helpers';

const money = (usd: number) => `$${usd.toLocaleString('en-US')}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  // Too heavy for any hotshot: the estimate moves to the flatbed price the semi drivers will expect.
  await page.getByLabel('Weight', { exact: true }).fill('42000');
  await expect(useSuggested).toHaveText(`Use suggested ${money(flatbed.suggestedUsd)}`);
  await expect(page.getByText(flatbed.basis, { exact: false })).toBeVisible();
  await expect(page.getByText(flatbed.basis, { exact: false })).toContainText('DAT national spot averages, Sept 2026');
});
