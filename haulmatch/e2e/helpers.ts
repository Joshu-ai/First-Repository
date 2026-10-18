// Shared helpers for the HaulMatch end-to-end tests. The server runs on a fresh in-memory database
// seeded with the demo data (see playwright.config.ts). Both projects (desktop, mobile) share that
// one server, so every test creates its own uniquely named loads instead of relying on seed rows
// another test or project may already have changed.
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { EquipmentCode, Load, MeResponse } from '../shared/types';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO = {
  hotshot: { email: 'hotshot@demo.haulmatch.app', name: 'Cody Ramirez' },
  semi: { email: 'semi@demo.haulmatch.app', name: 'Marcus Bell' },
  shipper: { email: 'shipper@demo.haulmatch.app', name: 'Dana Whitfield' },
} as const;

const CSRF = { [CSRF_HEADER]: CSRF_VALUE };
const HOUR_MS = 3_600_000;

/** A short id that is unique per test run, for commodity names, emails and messages. */
export function uniqueTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Signs a browser context in through the API (the cookie is shared with its pages). */
export async function signIn(context: BrowserContext, email: string): Promise<MeResponse> {
  const res = await context.request.post('/api/auth/login', { headers: CSRF, data: { email, password: DEMO_PASSWORD } });
  expect(res.ok(), `login as ${email}`).toBeTruthy();
  return (await res.json()) as MeResponse;
}

/** A second signed-in browser context (another person on another phone or desk) with its own page. */
export async function openAs(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page; me: MeResponse }> {
  const context = await browser.newContext();
  await blockMapTiles(context);
  const me = await signIn(context, email);
  const page = await context.newPage();
  return { context, page, me };
}

/** Map tiles come from the internet; abort them so tests never wait on the network. */
export async function blockMapTiles(context: BrowserContext): Promise<void> {
  await context.route(/tile\.openstreetmap\.org/, (route) => route.abort());
}

export interface LoadSpec {
  originCityId: string;
  destinationCityId: string;
  commodity: string;
  equipmentTypes: EquipmentCode[];
  weightLbs: number;
  lengthFt: number;
  rateUsd: number;
  bookingMode?: 'instant' | 'request';
  /** Hours from now until pickup opens. Default 2; the window stays open 24 hours. */
  pickupInHours?: number;
}

/** Posts a load as the demo shipper through the API and returns it. */
export async function postLoadAsShipper(api: APIRequestContext, spec: LoadSpec): Promise<Load> {
  const login = await api.post('/api/auth/login', { headers: CSRF, data: { email: DEMO.shipper.email, password: DEMO_PASSWORD } });
  expect(login.ok(), 'shipper login').toBeTruthy();
  const start = Date.now() + (spec.pickupInHours ?? 2) * HOUR_MS;
  const { pickupInHours: _ignored, ...body } = spec;
  const res = await api.post('/api/loads', {
    headers: CSRF,
    data: {
      ...body,
      pickupStart: new Date(start).toISOString(),
      pickupEnd: new Date(start + 24 * HOUR_MS).toISOString(),
      bookingMode: spec.bookingMode ?? 'request',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as Load;
}

/** Types into a city combobox and picks the suggestion for that city and state. */
export async function chooseCity(page: Page, label: string, query: string, state: string): Promise<void> {
  const input = page.getByRole('combobox', { name: label });
  await input.fill(query);
  await page
    .getByRole('listbox', { name: `${label} suggestions` })
    .getByRole('option')
    .filter({ hasText: query })
    .filter({ hasText: state })
    .first()
    .click();
  await expect(input).toHaveValue(`${query}, ${state}`);
}

/** The load card on the board whose freight is this commodity. */
export function loadCard(page: Page, commodity: string) {
  return page.locator('article.load-card').filter({ hasText: commodity });
}
