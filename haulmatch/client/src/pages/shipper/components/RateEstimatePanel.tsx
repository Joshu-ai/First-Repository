import type { City, EquipmentCode, RateEstimate } from '../../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { DetailList } from '../../../components/DataDisplay';
import { ErrorState, Skeleton, Spinner } from '../../../components/Feedback';
import { api } from '../../../lib/api';
import { miles, money, ratePerMile } from '../../../lib/format';
import { useApi, useDebounced } from '../../../lib/hooks';

export interface RateEstimatePanelProps {
  origin: City | null;
  destination: City | null;
  equipment: EquipmentCode[];
  /** The freight on the form, so a load too big for a hotshot is priced on the semi equipment. */
  weightLbs: number | null;
  lengthFt: number | null;
  /** The rate typed into the form, compared against the market range. */
  rateUsd: number | null;
  onUseSuggested: (usd: number) => void;
}

interface Keyed {
  key: string;
  estimate: RateEstimate;
}

function laneKey(
  origin: City | null,
  destination: City | null,
  equipment: EquipmentCode[],
  weightLbs: number | null,
  lengthFt: number | null,
): string | null {
  if (!origin || !destination || origin.id === destination.id) return null;
  return [origin.id, destination.id, [...equipment].sort().join(','), weightLbs ?? '', lengthFt ?? ''].join('|');
}

/** Where the posted rate sits against the estimate. */
function RatePosition({ rateUsd, estimate }: { rateUsd: number | null; estimate: RateEstimate }) {
  if (rateUsd === null) return null;
  if (rateUsd < estimate.lowUsd) {
    return (
      <p className="row">
        <Badge tone="warn" icon="warning">
          Below market
        </Badge>
        <span className="text-sm muted">Drivers may pass or send a counter-offer.</span>
      </p>
    );
  }
  if (rateUsd > estimate.highUsd) {
    return (
      <p className="row">
        <Badge tone="ok" icon="bolt">
          Above market
        </Badge>
        <span className="text-sm muted">Should cover fast.</span>
      </p>
    );
  }
  return (
    <p className="row">
      <Badge tone="info" icon="check">
        In the market range
      </Badge>
      <span className="text-sm muted">A fair rate for this lane.</span>
    </p>
  );
}

/**
 * Live market estimate (GET /api/rates/estimate) for the lane and equipment on the form, with a
 * "Use suggested" shortcut. Refetches as the lane or equipment changes, debounced.
 */
export function RateEstimatePanel({
  origin,
  destination,
  equipment,
  weightLbs,
  lengthFt,
  rateUsd,
  onUseSuggested,
}: RateEstimatePanelProps) {
  const key = laneKey(origin, destination, equipment, weightLbs, lengthFt);
  const debouncedKey = useDebounced(key, 300);
  const { data, error, loading, reload } = useApi<Keyed>(
    async (signal) => {
      const [originCityId, destinationCityId, codes, weight, length] = debouncedKey!.split('|');
      const estimate = await api.meta.rateEstimate(
        {
          originCityId,
          destinationCityId,
          equipment: (codes ? codes.split(',') : []) as EquipmentCode[],
          weightLbs: weight ? Number(weight) : null,
          lengthFt: length ? Number(length) : null,
        },
        { signal },
      );
      return { key: debouncedKey!, estimate };
    },
    [debouncedKey],
    { enabled: debouncedKey !== null },
  );

  if (key === null) {
    return (
      <div className="card card--muted stack-sm">
        <p className="strong">Market rate</p>
        <p className="muted text-sm">Pick pickup and delivery cities to see what this lane pays.</p>
      </div>
    );
  }

  const estimate = data?.estimate;
  const updating = loading || key !== debouncedKey || data?.key !== key;

  if (error && !updating) {
    return <ErrorState compact error={error} title="Couldn’t get a market rate" onRetry={() => void reload()} />;
  }

  if (!estimate) {
    return (
      <div className="card card--muted stack-sm" aria-busy="true">
        <p className="strong">Market rate</p>
        <Skeleton lines={3} height={16} />
        <span className="visually-hidden" role="status">
          Getting the market rate
        </span>
      </div>
    );
  }

  const rpm = estimate.ratePerMile;
  return (
    <div className="card card--muted stack-sm" aria-busy={updating || undefined}>
      <div className="row row-between">
        <p className="strong">Market rate for {miles(estimate.miles)}</p>
        {updating ? <Spinner size={16} label="Updating the market rate" /> : null}
      </div>
      <DetailList
        items={[
          { label: 'Low', value: `${money(estimate.lowUsd)} · ${ratePerMile(rpm.low)}` },
          { label: 'Suggested', value: `${money(estimate.suggestedUsd)} · ${ratePerMile(rpm.suggested)}`, strong: true },
          { label: 'High', value: `${money(estimate.highUsd)} · ${ratePerMile(rpm.high)}` },
        ]}
      />
      <p className="muted text-xs">{estimate.basis}. A monthly snapshot, not live market data.</p>
      <Button
        variant="secondary"
        icon="dollar"
        block
        disabled={updating || rateUsd === estimate.suggestedUsd}
        onClick={() => onUseSuggested(estimate.suggestedUsd)}
      >
        {rateUsd === estimate.suggestedUsd ? 'Using the suggested rate' : `Use suggested ${money(estimate.suggestedUsd)}`}
      </Button>
      <RatePosition rateUsd={rateUsd} estimate={estimate} />
    </div>
  );
}
