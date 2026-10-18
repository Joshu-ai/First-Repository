import { EQUIPMENT } from './equipment';
import type { EquipmentCode, RateEstimate } from './types';

/** Short runs pay more per mile; the uplift fades out by this distance. */
const SHORT_HAUL_MILES = 300;
const SHORT_HAUL_UPLIFT = 0.6;

/**
 * Suggested all-in rate for a lane. When a load accepts several equipment types the estimate
 * uses the cheapest one, since that is the carrier most likely to take it at market.
 */
export function estimateRate(miles: number, equipment: EquipmentCode[]): RateEstimate {
  const codes = equipment.length > 0 ? equipment : (['DRY_VAN'] as EquipmentCode[]);
  const cheapest = codes.reduce((best, code) =>
    EQUIPMENT[code].benchmarkRatePerMile < EQUIPMENT[best].benchmarkRatePerMile ? code : best,
  );
  const info = EQUIPMENT[cheapest];
  const safeMiles = Math.max(1, Math.round(miles));
  const uplift = 1 + SHORT_HAUL_UPLIFT * Math.max(0, (SHORT_HAUL_MILES - safeMiles) / SHORT_HAUL_MILES);
  const suggestedRaw = Math.max(info.minimumChargeUsd, safeMiles * info.benchmarkRatePerMile * uplift);
  const suggestedUsd = roundTo(suggestedRaw, 25);
  const lowUsd = roundTo(Math.max(info.minimumChargeUsd * 0.9, suggestedRaw * 0.88), 25);
  const highUsd = roundTo(suggestedRaw * 1.15, 25);
  const perMile = (usd: number) => Math.round((usd / safeMiles) * 100) / 100;
  return {
    miles: safeMiles,
    lowUsd,
    suggestedUsd,
    highUsd,
    ratePerMile: { low: perMile(lowUsd), suggested: perMile(suggestedUsd), high: perMile(highUsd) },
    basis: `${info.label} benchmark $${info.benchmarkRatePerMile.toFixed(2)}/mi${uplift > 1 ? ' with short-haul premium' : ''}`,
  };
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}
