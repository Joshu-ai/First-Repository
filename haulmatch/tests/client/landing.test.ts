import { describe, expect, it } from 'vitest';
import { EXAMPLE_DRIVER, EXAMPLE_MARKET_SHARE, exampleChecks, exampleLoad } from '../../client/src/pages/public/exampleLoad';
import { DEFAULT_FUEL_PRICE_PER_GALLON, DRIVER_CLASSES } from '../../shared/equipment';
import { marketRateFor } from '../../shared/matching';

// Local wall-clock times, so the assertions hold in any time zone.
const morning = new Date('2026-10-18T06:30:00');

describe('landing page example load', () => {
  it('is matched by the real engine at the current market, not frozen numbers', () => {
    // Regression: the card was hand-written for the old market ($3.75 diesel, flat $/mi benchmark),
    // so its fuel cost and profit disagreed with what the app computes.
    const load = exampleLoad(morning);
    const match = load.match!;
    expect(EXAMPLE_DRIVER.fuelPricePerGallon).toBe(DEFAULT_FUEL_PRICE_PER_GALLON);
    expect(match.fuelCostUsd).toBe(
      Math.round((match.totalMiles / DRIVER_CLASSES.hotshot.defaultMpg) * DEFAULT_FUEL_PRICE_PER_GALLON),
    );
    expect(match.estimatedProfitUsd).toBe(load.rateUsd - match.fuelCostUsd);
    expect(match.loadedMiles).toBe(load.miles);
    expect(load.ratePerMile).toBeCloseTo(load.rateUsd / load.miles, 2);
  });

  it('reads "Pays above market" because it really pays above the lane market', () => {
    const load = exampleLoad(morning);
    const market = marketRateFor(load, load.match!.matchedEquipment, load.match!.totalMiles);
    expect(load.rateUsd / market).toBeGreaterThanOrEqual(1.1);
    expect(load.rateUsd / market).toBeCloseTo(EXAMPLE_MARKET_SHARE, 1);
    expect(load.match).toMatchObject({ eligible: true, matchedEquipment: ['HS_GOOSENECK'] });
    expect(load.match!.highlights).toEqual(expect.arrayContaining(['Pickup is close by', 'Pays above market']));
    expect(load.match!.score).toBeGreaterThanOrEqual(85);
  });

  it('scores the same whatever time of day the page is opened', () => {
    const scores = ['00:05', '06:30', '12:00', '23:55'].map((t) => exampleLoad(new Date(`2026-10-18T${t}:00`)).match!.score);
    expect(new Set(scores).size).toBe(1);
  });

  it('shows the rig checks in the engine’s words, all passing', () => {
    const checks = exampleChecks(exampleLoad(morning));
    expect(checks.map((c) => c.key)).toEqual(['equipment', 'weight', 'length', 'deadhead']);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks[1].label).toBe('9,200 lbs of your 10,000 lbs capacity, no CDL needed');
    expect(checks[3].label).toMatch(/^\d+ mi deadhead to pickup$/);
  });
});
