import { cx } from '../lib/cx';

/** The HaulMatch mark: two stops joined by a route on a safety-orange tile. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('logo-mark', className)} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path
        d="M9 22.5c0-4 3-5.5 7-5.5s7-1.5 7-5.5"
        fill="none"
        stroke="var(--brand-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="9" cy="22.5" r="3.2" fill="var(--brand-ink)" />
      <circle cx="23" cy="10.5" r="3.2" fill="var(--brand-ink)" />
    </svg>
  );
}

/** Mark plus wordmark. `inverse` for use on the navy app bar. */
export function Logo({ inverse, className }: { inverse?: boolean; className?: string }) {
  return (
    <span className={cx('logo', inverse && 'logo--inverse', className)}>
      <LogoMark />
      <span className="logo__word">
        Haul<span className="logo__accent">Match</span>
      </span>
    </span>
  );
}
