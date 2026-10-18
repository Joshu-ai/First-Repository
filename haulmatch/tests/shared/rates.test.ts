import { describe, expect, it } from 'vitest';
import { EQUIPMENT, EQUIPMENT_CODES } from '../../shared/equipment';
import { estimateRate } from '../../shared/rates';
import type { EquipmentCode } from '../../shared/types';

const perMile = (usd: number, miles: number) => Math.round((usd / miles) * 100) / 100;
const roundTo25 = (usd: number) => Math.max(25, Math.round(usd / 25) * 25);

describe('estimateRate: long runs', () => {
  it('charges the benchmark per mile from 300 miles on, with no short-haul premium', () => {
    expect(estimateRate(1_000, ['DRY_VAN'])).toEqual({
      miles: 1_000,
      lowUsd: 1_850,
      suggestedUsd: 2_100,
      highUsd: 2_425,
      ratePerMile: { low: 1.85, suggested: 2.1, high: perMile(2_425, 1_000) },
      basis: "Dry van (53') benchmark $2.10/mi",
    });
  });

  it('prices every equipment type at its own benchmark', () => {
    for (const code of EQUIPMENT_CODES) {
      const info = EQUIPMENT[code];
      const e = estimateRate(2_000, [code]);
      expect(e.suggestedUsd).toBe(roundTo25(2_000 * info.benchmarkRatePerMile));
      expect(e.lowUsd).toBe(roundTo25(Math.max(info.minimumChargeUsd * 0.9, 2_000 * info.benchmarkRatePerMile * 0.88)));
      expect(e.highUsd).toBe(roundTo25(2_000 * info.benchmarkRatePerMile * 1.15));
      expect(e.basis).toBe(`${info.label} benchmark $${info.benchmarkRatePerMile.toFixed(2)}/mi`);
    }
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
    const e = estimateRate(10, ['HS_GOOSENECK']);
    expect(e).toMatchObject({ lowUsd: 275, suggestedUsd: 300, highUsd: 350 });
    expect(e.ratePerMile).toEqual({ low: 27.5, suggested: 30, high: 35 });
    expect(e.basis).toBe('Hotshot gooseneck flatbed benchmark $1.85/mi with short-haul premium');
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
      expect(suggested).toBeLessThan(short[short.length - 1]);
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
    const same = EQUIPMENT_CODES.filter((c) => EQUIPMENT[c].benchmarkRatePerMile === EQUIPMENT.HS_CAR_HAULER.benchmarkRatePerMile);
    expect(same).toEqual(['HS_CAR_HAULER', 'POWER_ONLY']);
    expect(estimateRate(500, ['POWER_ONLY', 'HS_CAR_HAULER']).basis).toContain(EQUIPMENT.POWER_ONLY.label);
    expect(estimateRate(500, ['HS_CAR_HAULER', 'POWER_ONLY']).basis).toContain(EQUIPMENT.HS_CAR_HAULER.label);
  });

  it('falls back to a dry van when no equipment is given', () => {
    expect(estimateRate(500, [])).toEqual(estimateRate(500, ['DRY_VAN']));
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
