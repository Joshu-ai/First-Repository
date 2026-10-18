import { cx } from '../lib/cx';
import { scoreLabel, scoreTier } from '../lib/format';

export interface ScoreBadgeProps {
  /** 0–100 match score. */
  score: number;
  /** When false the ring is empty and reads "Not a fit". Default true. */
  eligible?: boolean;
  /** sm = 40px (lists, dense), md = 56px (load cards), lg = 88px (load detail hero). */
  size?: 'sm' | 'md' | 'lg';
  /** Show the text label ("Great match") next to (md) or under (lg) the ring. Default true for md/lg. */
  showLabel?: boolean;
  /** Accessible name when not eligible. Shippers looking at a driver pass "Not a fit for this load". */
  ineligibleLabel?: string;
  className?: string;
}

const SIZES = { sm: 40, md: 56, lg: 88 } as const;
const STROKES = { sm: 4, md: 5, lg: 7 } as const;

/**
 * Circular 0–100 match score. Color follows the tier (great/good/fair/weak) and the tier is
 * also written out, so color is never the only signal.
 */
export function ScoreBadge({
  score,
  eligible = true,
  size = 'md',
  showLabel,
  ineligibleLabel = 'Not a fit for your rig',
  className,
}: ScoreBadgeProps) {
  const px = SIZES[size];
  const stroke = STROKES[size];
  const r = (px - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = eligible ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const tier = scoreTier(clamped, eligible);
  const label = scoreLabel(clamped, eligible);
  const withLabel = showLabel ?? size !== 'sm';

  return (
    <span
      className={cx('score', `score--${tier}`, `score--${size}`, className)}
      role="img"
      aria-label={eligible ? `Match score ${clamped} out of 100: ${label}` : ineligibleLabel}
    >
      <span className="score__ring" style={{ width: px, height: px }}>
        <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true">
          <circle className="score__track" cx={px / 2} cy={px / 2} r={r} strokeWidth={stroke} fill="none" />
          <circle
            className="score__value"
            cx={px / 2}
            cy={px / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
          />
        </svg>
        <span className="score__number" aria-hidden="true">
          {eligible ? clamped : '–'}
        </span>
      </span>
      {withLabel ? (
        <span className="score__label" aria-hidden="true">
          {label}
        </span>
      ) : null}
    </span>
  );
}
