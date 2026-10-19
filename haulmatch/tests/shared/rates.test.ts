import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUEL_PRICE_PER_GALLON,
  DRIVER_CLASSES,
  EQUIPMENT,
  EQUIPMENT_CODES,
  HOTSHOT_MAX_LENGTH_FT,
  HOTSHOT_MAX_PAYLOAD_LBS,
  MARKET_SNAPSHOT,
} from '../../shared/equipment';
import { estimateRate, marketEquipment } from '../../shared/rates';
import type { EquipmentCode } from '../../shared/types';

const perMile = (usd: number, miles: number) => Math.round((usd / miles) * 100) / 100;
const roundTo25 = (usd: number) => Math.max(25, Math.round(usd / 25) * 25);
/** Where a benchmark comes from, as the estimate's basis names it. */
const sourceOf = (code: EquipmentCode) =>
  EQUIPMENT[code].benchmarkFromDat ? MARKET_SNAPSHOT.label : `estimated from ${MARKET_SNAPSHOT.label}`;

describe('market snapshot', () => {
  it('uses DAT national spot averages for September 2026, fuel included', () => {
    expect(MARKET_SNAPSHOT).toEqual({
      asOf: '2026-09',
      label: 'DAT national spot averages, Sept 2026 (fuel included)',
      dieselUsdPerGallon: 6.29,
    });
    expect(EQUIPMENT.DRY_VAN.benchmarkRatePerMile).toBe(3.01);
    expect(EQUIPMENT.REEFER.benchmarkRatePerMile).toBe(3.62);
    expect(EQUIPMENT.FLATBED.benchmarkRatePerMile).toBe(3.61);
    expect(EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].benchmarkFromDat)).toEqual(['DRY_VAN', 'REEFER', 'FLATBED']);
    expect(DEFAULT_FUEL_PRICE_PER_GALLON).toBe(MARKET_SNAPSHOT.dieselUsdPerGallon);
    expect(DRIVER_CLASSES.hotshot.defaultMinRatePerMile).toBe(1.85);
    expect(DRIVER_CLASSES.semi.defaultMinRatePerMile).toBe(2.4);
  });

  it('keeps every default minimum rate under the cheapest benchmark of its class', () => {
    for (const info of Object.values(DRIVER_CLASSES)) {
      const benchmarks = EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].driverClass === info.driverClass).map(
        (c) => EQUIPMENT[c].benchmarkRatePerMile,
      );
      expect(info.defaultMinRatePerMile).toBeLessThan(Math.min(...benchmarks));
    }
  });

  it('sets every minimum charge in whole $25 steps, above a short run at the benchmark', () => {
    for (const code of EQUIPMENT_CODES) {
      const { minimumChargeUsd, benchmarkRatePerMile } = EQUIPMENT[code];
      expect(minimumChargeUsd % 25, code).toBe(0);
      expect(minimumChargeUsd, code).toBeGreaterThan(100 * benchmarkRatePerMile);
    }
  });
});

describe('estimateRate: long runs', () => {
  it('charges the benchmark per mile from 300 miles on, with no short-haul premium', () => {
    const { benchmarkRatePerMile: bench, minimumChargeUsd: min, label } = EQUIPMENT.DRY_VAN;
    const lowUsd = roundTo25(Math.max(min * 0.9, 1_000 * bench * 0.88));
    const suggestedUsd = roundTo25(1_000 * bench);
    const highUsd = roundTo25(1_000 * bench * 1.15);
    expect(estimateRate(1_000, ['DRY_VAN'])).toEqual({
      miles: 1_000,
      lowUsd,
      suggestedUsd,
      highUsd,
      ratePerMile: { low: perMile(lowUsd, 1_000), suggested: perMile(suggestedUsd, 1_000), high: perMile(highUsd, 1_000) },
      basis: `${label} benchmark $${bench.toFixed(2)}/mi · ${MARKET_SNAPSHOT.label}`,
    });
  });

  it('prices every equipment type at its own benchmark', () => {
    for (const code of EQUIPMENT_CODES) {
      const info = EQUIPMENT[code];
      const e = estimateRate(2_000, [code]);
      expect(e.suggestedUsd).toBe(roundTo25(2_000 * info.benchmarkRatePerMile));
      expect(e.lowUsd).toBe(roundTo25(Math.max(info.minimumChargeUsd * 0.9, 2_000 * info.benchmarkRatePerMile * 0.88)));
      expect(e.highUsd).toBe(roundTo25(2_000 * info.benchmarkRatePerMile * 1.15));
      expect(e.basis).toBe(`${info.label} benchmark $${info.benchmarkRatePerMile.toFixed(2)}/mi · ${sourceOf(code)}`);
    }
  });

  it('names the market snapshot, and says when a benchmark is derived rather than a DAT average', () => {
    expect(estimateRate(500, ['FLATBED']).basis).toBe(`${EQUIPMENT.FLATBED.label} benchmark $3.61/mi · ${MARKET_SNAPSHOT.label}`);
    expect(estimateRate(500, ['HS_GOOSENECK']).basis).toContain(`estimated from ${MARKET_SNAPSHOT.label}`);
  });
});

describe('estimateRate: short runs', () => {
  it('never suggests less than the minimum charge', () => {
    for (const code of EQUIPMENT_CODES) {
      for (const miles of [1, 10, 50]) {
        expect(estimateRate(miles, [code]).suggestedUsd).toBe(roundTo25(EQUIPMENT[code].minimumChargeUsd));
      }
    }
  });

  it('keeps the low end of a minimum-charge run near the minimum', () => {
    const { minimumChargeUsd: min, benchmarkRatePerMile: bench, label } = EQUIPMENT.HS_GOOSENECK;
    const e = estimateRate(10, ['HS_GOOSENECK']);
    const expected = { lowUsd: roundTo25(min * 0.9), suggestedUsd: roundTo25(min), highUsd: roundTo25(min * 1.15) };
    expect(e).toMatchObject(expected);
    expect(e.lowUsd).toBeGreaterThanOrEqual(min * 0.85);
    expect(e.ratePerMile).toEqual({ low: expected.lowUsd / 10, suggested: expected.suggestedUsd / 10, high: expected.highUsd / 10 });
    expect(e.basis).toBe(
      `${label} benchmark $${bench.toFixed(2)}/mi with short-haul premium · estimated from ${MARKET_SNAPSHOT.label}`,
    );
  });

  it('adds a short-haul premium that fades out by 300 miles', () => {
    const bench = EQUIPMENT.HS_GOOSENECK.benchmarkRatePerMile;
    // 150 mi is halfway: 1 + 0.6 * 0.5 = 30% uplift.
    expect(estimateRate(150, ['HS_GOOSENECK']).suggestedUsd).toBe(roundTo25(150 * bench * 1.3));
    expect(estimateRate(200, ['HS_GOOSENECK']).suggestedUsd).toBe(roundTo25(200 * bench * 1.2));
    expect(estimateRate(299, ['HS_GOOSENECK']).basis).toContain('short-haul premium');
    expect(estimateRate(300, ['HS_GOOSENECK']).basis).not.toContain('short-haul premium');
    expect(estimateRate(300, ['HS_GOOSENECK']).suggestedUsd).toBe(roundTo25(300 * bench));
    expect(estimateRate(301, ['HS_GOOSENECK']).suggestedUsd).toBe(roundTo25(301 * bench));
  });

  it('pays more per mile on shorter runs and settles at the benchmark from 300 miles', () => {
    const bench = EQUIPMENT.FLATBED.benchmarkRatePerMile;
    const short = [150, 200, 250, 299].map((m) => estimateRate(m, ['FLATBED']).ratePerMile.suggested);
    for (let i = 1; i < short.length; i += 1) expect(short[i]).toBeLessThan(short[i - 1]);
    for (const miles of [300, 600, 1_500]) {
      const { suggested } = estimateRate(miles, ['FLATBED']).ratePerMile;
      // 250 mi carries a 10% premium, more than the $25 rounding can make up at any longer run.
      // (At 299 mi the premium is 0.2%, smaller than rounding, so it is not compared here.)
      expect(suggested).toBeLessThan(short[2]);
      // Only the $25 rounding separates the long-run rate from the benchmark.
      expect(Math.abs(suggested - bench)).toBeLessThanOrEqual(12.5 / miles + 0.005);
    }
  });
});

describe('estimateRate: equipment choice', () => {
  it('prices a multi-equipment load at the cheapest equipment', () => {
    const e = estimateRate(500, ['FLATBED', 'HS_GOOSENECK', 'STEP_DECK']);
    expect(e).toEqual(estimateRate(500, ['HS_GOOSENECK']));
    expect(e.basis).toContain(EQUIPMENT.HS_GOOSENECK.label);
  });

  it('keeps the first of equally cheap equipment', () => {
    const same = EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].benchmarkRatePerMile === EQUIPMENT.TANKER.benchmarkRatePerMile);
    expect(same).toEqual(['TANKER', 'DRY_BULK']);
    expect(estimateRate(500, ['DRY_BULK', 'TANKER']).basis).toContain(EQUIPMENT.DRY_BULK.label);
    expect(estimateRate(500, ['TANKER', 'DRY_BULK']).basis).toContain(EQUIPMENT.TANKER.label);
    expect(marketEquipment(['DRY_BULK', 'TANKER'])).toBe('DRY_BULK');
    expect(marketEquipment(['TANKER', 'DRY_BULK'])).toBe('TANKER');
  });

  it('falls back to a dry van when no equipment is given', () => {
    expect(estimateRate(500, [])).toEqual(estimateRate(500, ['DRY_VAN']));
    expect(marketEquipment([])).toBe('DRY_VAN');
  });

  it('prices on the cheapest listed type', () => {
    expect(marketEquipment(['STEP_DECK', 'FLATBED'])).toBe('FLATBED');
    expect(marketEquipment(['HS_DOVETAIL', 'HS_GOOSENECK', 'HS_BUMPER_PULL'])).toBe('HS_BUMPER_PULL');
  });
});

describe('estimateRate: freight too big for a hotshot', () => {
  // Regression: a 45,000 lb flatbed load with "open to hotshot" left on was priced at hotshot rates,
  // so "use suggested" underpriced it for the flatbed drivers who can actually haul it.
  const mixed: EquipmentCode[] = ['FLATBED', 'HS_GOOSENECK', 'HS_DOVETAIL'];

  it('drops hotshot types for freight over the hotshot payload or deck length', () => {
    expect(estimateRate(500, mixed, { weightLbs: 45_000 })).toEqual(estimateRate(500, ['FLATBED']));
    expect(estimateRate(500, mixed, { weightLbs: HOTSHOT_MAX_PAYLOAD_LBS + 1, lengthFt: 20 })).toEqual(estimateRate(500, ['FLATBED']));
    expect(estimateRate(500, mixed, { weightLbs: 8_000, lengthFt: HOTSHOT_MAX_LENGTH_FT + 1 })).toEqual(estimateRate(500, ['FLATBED']));
    expect(estimateRate(500, mixed, { weightLbs: 45_000 }).suggestedUsd).toBeGreaterThan(estimateRate(500, mixed).suggestedUsd);
  });

  it('keeps hotshot pricing for freight a hotshot can carry, or when the freight is not known', () => {
    const atTheLimits = { weightLbs: HOTSHOT_MAX_PAYLOAD_LBS, lengthFt: HOTSHOT_MAX_LENGTH_FT };
    expect(estimateRate(500, mixed, atTheLimits)).toEqual(estimateRate(500, ['HS_GOOSENECK']));
    expect(estimateRate(500, mixed, {})).toEqual(estimateRate(500, ['HS_GOOSENECK']));
    expect(estimateRate(500, mixed, { weightLbs: null, lengthFt: null })).toEqual(estimateRate(500, ['HS_GOOSENECK']));
  });

  it('still prices hotshot-only equipment on hotshot rates rather than inventing a semi', () => {
    expect(marketEquipment(['HS_GOOSENECK', 'HS_DOVETAIL'], { weightLbs: 30_000 })).toBe('HS_GOOSENECK');
    expect(estimateRate(500, ['HS_GOOSENECK'], { weightLbs: 30_000 })).toEqual(estimateRate(500, ['HS_GOOSENECK']));
  });
});

describe('estimateRate: shape and rounding', () => {
  const sweep: [number, EquipmentCode][] = [];
  for (const code of EQUIPMENT_CODES) for (const miles of [1, 7, 42, 99, 150, 249, 300, 512, 1_234, 2_900]) sweep.push([miles, code]);

  it('keeps low <= suggested <= high', () => {
    for (const [miles, code] of sweep) {
      const e = estimateRate(miles, [code]);
      expect(e.lowUsd).toBeLessThanOrEqual(e.suggestedUsd);
      expect(e.suggestedUsd).toBeLessThanOrEqual(e.highUsd);
      expect(e.lowUsd).toBeLessThan(e.highUsd);
    }
  });

  it('rounds every dollar figure to $25', () => {
    for (const [miles, code] of sweep) {
      const e = estimateRate(miles, [code]);
      for (const usd of [e.lowUsd, e.suggestedUsd, e.highUsd]) {
        expect(usd % 25).toBe(0);
        expect(usd).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('derives the per-mile figures from the rounded dollars', () => {
    for (const [miles, code] of sweep) {
      const e = estimateRate(miles, [code]);
      expect(e.ratePerMile).toEqual({
        low: perMile(e.lowUsd, e.miles),
        suggested: perMile(e.suggestedUsd, e.miles),
        high: perMile(e.highUsd, e.miles),
      });
    }
  });

  it('never suggests less for a longer run', () => {
    for (const code of EQUIPMENT_CODES) {
      let previous = 0;
      for (let miles = 1; miles <= 1_200; miles += 7) {
        const { suggestedUsd } = estimateRate(miles, [code]);
        expect(suggestedUsd).toBeGreaterThanOrEqual(previous);
        previous = suggestedUsd;
      }
    }
  });

  it('rounds the miles and treats zero or negative miles as one mile', () => {
    expect(estimateRate(499.6, ['DRY_VAN']).miles).toBe(500);
    expect(estimateRate(499.6, ['DRY_VAN'])).toEqual(estimateRate(500, ['DRY_VAN']));
    expect(estimateRate(0, ['DRY_VAN']).miles).toBe(1);
    expect(estimateRate(-20, ['DRY_VAN'])).toEqual(estimateRate(1, ['DRY_VAN']));
  });
});
