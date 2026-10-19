import { EQUIPMENT, HOTSHOT_MAX_LENGTH_FT, HOTSHOT_MAX_PAYLOAD_LBS, MARKET_SNAPSHOT } from './equipment';
import type { EquipmentCode, RateEstimate } from './types';

/** Short runs pay more per mile; the uplift fades out by this distance. */
const SHORT_HAUL_MILES = 300;
const SHORT_HAUL_UPLIFT = 0.6;

/** The freight being priced, when known. Hotshot rigs cannot carry freight past their limits. */
export interface RateFreight {
  weightLbs?: number | null;
  lengthFt?: number | null;
}

/** Whether a hotshot rig can carry this freight at all (HOTSHOT_MAX_PAYLOAD_LBS / HOTSHOT_MAX_LENGTH_FT). */
function hotshotCanCarry(freight: RateFreight): boolean {
  return (freight.weightLbs ?? 0) <= HOTSHOT_MAX_PAYLOAD_LBS && (freight.lengthFt ?? 0) <= HOTSHOT_MAX_LENGTH_FT;
}

/**
 * The equipment a load is priced on: the cheapest of the accepted types that can carry the freight,
 * since that is the carrier most likely to take it at market. Hotshot types are dropped for freight
 * no hotshot can haul, unless nothing else is listed. Ties keep the first listed type; no equipment
 * prices as a dry van. Matching and the rate estimate both use this, so they agree on the market.
 */
export function marketEquipment(equipment: EquipmentCode[], freight: RateFreight = {}): EquipmentCode {
  const listed = equipment.length > 0 ? equipment : (['DRY_VAN'] as EquipmentCode[]);
  const carriers = hotshotCanCarry(freight) ? listed : listed.filter((code) => EQUIPMENT[code].driverClass !== 'hotshot');
  const codes = carriers.length > 0 ? carriers : listed;
  return codes.reduce((best, code) =>
    EQUIPMENT[code].benchmarkRatePerMile < EQUIPMENT[best].benchmarkRatePerMile ? code : best,
  );
}

/**
 * Suggested all-in rate for a lane (MARKET_SNAPSHOT benchmarks), priced on marketEquipment():
 * the per-mile benchmark, plus a short-haul premium under 300 miles, never below the minimum charge.
 */
export function estimateRate(miles: number, equipment: EquipmentCode[], freight: RateFreight = {}): RateEstimate {
  const info = EQUIPMENT[marketEquipment(equipment, freight)];
  const safeMiles = Math.max(1, Math.round(miles));
  const uplift = 1 + SHORT_HAUL_UPLIFT * Math.max(0, (SHORT_HAUL_MILES - safeMiles) / SHORT_HAUL_MILES);
  const suggestedRaw = Math.max(info.minimumChargeUsd, safeMiles * info.benchmarkRatePerMile * uplift);
  const suggestedUsd = roundTo(suggestedRaw, 25);
  const lowUsd = roundTo(Math.max(info.minimumChargeUsd * 0.9, suggestedRaw * 0.88), 25);
  const highUsd = roundTo(suggestedRaw * 1.15, 25);
  const perMile = (usd: number) => Math.round((usd / safeMiles) * 100) / 100;
  const premium = uplift > 1 ? ' with short-haul premium' : '';
  const source = info.benchmarkFromDat ? MARKET_SNAPSHOT.label : `estimated from ${MARKET_SNAPSHOT.label}`;
  return {
    miles: safeMiles,
    lowUsd,
    suggestedUsd,
    highUsd,
    ratePerMile: { low: perMile(lowUsd), suggested: perMile(suggestedUsd), high: perMile(highUsd) },
    basis: `${info.label} benchmark $${info.benchmarkRatePerMile.toFixed(2)}/mi${premium} · ${source}`,
  };
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}
