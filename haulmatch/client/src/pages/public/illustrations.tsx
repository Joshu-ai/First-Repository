// Decorative rig illustrations for the landing and signup cards. Navy parts use currentColor,
// cargo uses the brand orange, windows use the surface color.

interface ArtProps {
  className?: string;
  height?: number;
}

/** 1-ton dually pulling a gooseneck flatbed with a pipe load. */
export function HotshotArt({ className, height = 56 }: ArtProps) {
  return (
    <svg className={className} height={height} viewBox="0 0 164 58" fill="none" aria-hidden="true" focusable="false">
      <rect x="10" y="26" width="54" height="11" rx="2" fill="var(--brand)" />
      <path d="M24 26v11M38 26v11M52 26v11" stroke="var(--brand-ink)" strokeOpacity=".35" strokeWidth="2" />
      <rect x="4" y="37" width="76" height="6" rx="1.5" fill="currentColor" />
      <path d="M74 37V28h26v8" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      <rect x="90" y="34" width="26" height="10" rx="1.5" fill="currentColor" />
      <path d="M114 44V23a3 3 0 0 1 3-3h15l9 11h10a5 5 0 0 1 5 5v8z" fill="currentColor" />
      <path d="M119 23h12l7 8.5h-19z" fill="var(--surface)" />
      <circle cx="22" cy="48" r="7" fill="currentColor" />
      <circle cx="38" cy="48" r="7" fill="currentColor" />
      <circle cx="102" cy="48" r="7" fill="currentColor" />
      <circle cx="142" cy="48" r="7" fill="currentColor" />
      <circle cx="22" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="38" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="102" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="142" cy="48" r="2.5" fill="var(--surface)" />
    </svg>
  );
}

/** Sleeper tractor and 53' dry van. */
export function SemiArt({ className, height = 56 }: ArtProps) {
  return (
    <svg className={className} height={height} viewBox="0 0 164 58" fill="none" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="98" height="32" rx="2.5" fill="var(--brand)" />
      <path d="M4 30h98" stroke="var(--brand-ink)" strokeOpacity=".3" strokeWidth="2" />
      <rect x="4" y="38" width="98" height="5" fill="currentColor" />
      <rect x="100" y="38" width="10" height="5" fill="currentColor" />
      <path d="M108 43V16a3 3 0 0 1 3-3h20l11 14h12a5 5 0 0 1 5 5v11z" fill="currentColor" />
      <path d="M132 16h-6v11h15z" fill="var(--surface)" />
      <path d="M110 22h12" stroke="var(--surface)" strokeOpacity=".35" strokeWidth="2" />
      <circle cx="70" cy="48" r="7" fill="currentColor" />
      <circle cx="86" cy="48" r="7" fill="currentColor" />
      <circle cx="116" cy="48" r="7" fill="currentColor" />
      <circle cx="131" cy="48" r="7" fill="currentColor" />
      <circle cx="152" cy="48" r="7" fill="currentColor" />
      <circle cx="70" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="86" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="116" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="131" cy="48" r="2.5" fill="var(--surface)" />
      <circle cx="152" cy="48" r="2.5" fill="var(--surface)" />
    </svg>
  );
}

/** Warehouse with a roll-up door and freight on the dock. */
export function ShipperArt({ className, height = 56 }: ArtProps) {
  return (
    <svg className={className} height={height} viewBox="0 0 164 58" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 56V24L50 6l42 18v32z" fill="currentColor" />
      <rect x="32" y="32" width="36" height="24" fill="var(--surface)" />
      <path d="M32 38h36M32 44h36M32 50h36" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" />
      <rect x="104" y="38" width="22" height="18" rx="1.5" fill="var(--brand)" />
      <rect x="128" y="38" width="22" height="18" rx="1.5" fill="var(--brand)" />
      <rect x="116" y="18" width="22" height="18" rx="1.5" fill="var(--brand)" />
      <path d="M115 38v18M139 38v18M127 18v18" stroke="var(--brand-ink)" strokeOpacity=".35" strokeWidth="2" />
      <path d="M98 56h60" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
