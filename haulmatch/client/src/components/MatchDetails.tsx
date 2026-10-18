// Explains a MatchResult: which checks passed, how the score breaks down, and the money.
import type { Load, MatchBreakdown, MatchCheck, MatchResult } from '../../../shared/types';
import { cx } from '../lib/cx';
import { miles, money, ratePerMile } from '../lib/format';
import { Icon } from './Icon';

export interface MatchChecksProps {
  checks: MatchCheck[];
  /** Hide passing soft checks to keep the list short. Default false. */
  onlyImportant?: boolean;
  className?: string;
}

/** Pass/fail list ("Your gooseneck works", "Too heavy: ..."). Failed hard checks come first. */
export function MatchChecks({ checks, onlyImportant, className }: MatchChecksProps) {
  const rank = (c: MatchCheck) => (c.ok ? 2 : c.hard ? 0 : 1);
  const list = [...checks]
    .filter((c) => c.key !== 'status' || !c.ok)
    .filter((c) => !onlyImportant || !c.ok || c.hard)
    .sort((a, b) => rank(a) - rank(b));
  return (
    <ul className={cx('checks', className)}>
      {list.map((c, i) => {
        const state = c.ok ? 'ok' : c.hard ? 'bad' : 'warn';
        return (
          <li key={`${c.key}-${i}`} className={cx('checks__item', `checks__item--${state}`)}>
            <span className="checks__icon" aria-hidden="true">
              <Icon name={c.ok ? 'check' : c.hard ? 'x' : 'warning'} size={16} />
            </span>
            <span>
              <span className="visually-hidden">{c.ok ? 'OK: ' : c.hard ? 'Blocker: ' : 'Heads up: '}</span>
              {c.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const BREAKDOWN_LABELS: Record<keyof MatchBreakdown, string> = {
  rate: 'Pay',
  deadhead: 'Deadhead',
  timing: 'Timing',
  fit: 'Rig fit',
  lane: 'Lane',
};

const BREAKDOWN_ORDER: (keyof MatchBreakdown)[] = ['rate', 'deadhead', 'timing', 'fit', 'lane'];

/** Five 0–100 bars showing what drives the score. */
export function MatchBreakdownBars({ breakdown, className }: { breakdown: MatchBreakdown; className?: string }) {
  return (
    <dl className={cx('breakdown', className)}>
      {BREAKDOWN_ORDER.map((key) => {
        const value = Math.max(0, Math.min(100, Math.round(breakdown[key])));
        return (
          <div key={key} className="breakdown__row">
            <dt className="breakdown__label">{BREAKDOWN_LABELS[key]}</dt>
            <dd className="breakdown__value">
              <span className="breakdown__bar" aria-hidden="true">
                <span
                  className={cx('breakdown__fill', value >= 70 ? 'is-high' : value >= 40 ? 'is-mid' : 'is-low')}
                  style={{ width: `${value}%` }}
                />
              </span>
              <span className="breakdown__num num">{value}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface ProfitSummaryProps {
  load: Pick<Load, 'rateUsd' | 'miles' | 'ratePerMile'>;
  match: MatchResult | null | undefined;
  /** Show a counter-offer amount instead of the posted rate (fuel and miles stay the same). */
  offerRateUsd?: number | null;
  className?: string;
}

/**
 * The money breakdown a driver checks before booking: posted rate, loaded vs deadhead miles,
 * all-in $/mi and estimated fuel and profit. Without a match it shows rate and $/mi only.
 */
export function ProfitSummary({ load, match, offerRateUsd, className }: ProfitSummaryProps) {
  const rate = offerRateUsd ?? load.rateUsd;
  const rows: { label: string; value: string; strong?: boolean; tone?: 'bad' }[] = [
    { label: offerRateUsd ? 'Your offer' : 'Posted rate', value: money(rate), strong: true },
    { label: 'Loaded miles', value: miles(load.miles) },
    { label: 'Rate per loaded mile', value: ratePerMile(rate / Math.max(1, load.miles)) },
  ];
  if (match) {
    const fuel = match.fuelCostUsd;
    const profit = rate - fuel;
    rows.push(
      { label: 'Deadhead to pickup', value: match.deadheadMiles === null ? 'Set your location' : miles(match.deadheadMiles) },
      { label: 'All-in $/mi (with deadhead)', value: ratePerMile(rate / Math.max(1, match.totalMiles)) },
      { label: 'Est. fuel', value: `−${money(fuel)}` },
      { label: 'Est. profit after fuel', value: money(profit), strong: true, tone: profit < 0 ? 'bad' : undefined },
    );
  }
  return (
    <dl className={cx('detail-list', 'profit-summary', className)}>
      {rows.map((r) => (
        <div key={r.label} className={cx('detail-list__row', r.strong && 'detail-list__row--strong')}>
          <dt>{r.label}</dt>
          <dd className={cx('num', r.tone === 'bad' && 'text-bad')}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
