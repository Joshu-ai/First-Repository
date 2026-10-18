import type { ReactNode, SVGProps } from 'react';

// 24x24 stroke icons drawn for HaulMatch. They inherit `currentColor`.
const PATHS = {
  boxes: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 5.5h11v10h-11z" />
      <path d="M13.5 9h4.2l3.3 3.6v2.9h-7.5" />
      <circle cx="6.5" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="5" r="2.2" />
      <path d="M8.2 19h7.3a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7h7.3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" />
      <path d="M10.2 20.5a2 2 0 0 0 3.6 0" />
    </>
  ),
  siren: (
    <>
      <path d="M7 18v-6a5 5 0 0 1 10 0v6" />
      <path d="M4.5 21h15M12 2v2M4.6 5.1 6 6.5M19.4 5.1 18 6.5M2 12h2M20 12h2" />
    </>
  ),
  message: <path d="M20.5 14.5a2 2 0 0 1-2 2H8l-4.5 4V5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4a6.5 6.5 0 0 1 3.5 5.6" />
    </>
  ),
  grid: <path d="M3.5 3.5h7v8h-7zM13.5 3.5h7v5h-7zM13.5 11.5h7v9h-7zM3.5 14.5h7v6h-7z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  plusSquare: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  filter: <path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5z" />,
  map: <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  navigation: <path d="M3.5 11 20.5 3.5 13 20.5l-2-7.5z" />,
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20.5h-5.5v-6h-6v6H3.5z" />,
  fuel: (
    <>
      <path d="M4.5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3 21h12M4.5 10h9" />
      <path d="M13.5 8h2l3 3v6.5a1.5 1.5 0 0 1-3 0V15h-2" />
    </>
  ),
  dollar: (
    <path d="M12 3v18M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1.1-4.5 3 2 2.7 4.5 3.2 4.5 1.4 4.5 3.3-2 3.2-4.5 3.2-4.5-1.3-4.5-3.2" />
  ),
  weight: (
    <>
      <path d="M6.5 9h11l2.5 11.5H4z" />
      <circle cx="12" cy="5.5" r="2.5" />
    </>
  ),
  ruler: <path d="M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />,
  hazard: (
    <>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  tarp: <path d="M2.5 18h19M4 18v-6c0-2.2 2.5-4.5 8-4.5s8 2.3 8 4.5v6M8 8.2V18M16 8.2V18" />,
  bolt: <path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3.5" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 3.5V8h4.5M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20.5V16h-4.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  warning: <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  eye: (
    <>
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  phone: (
    <path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19.2 19.2 0 0 1-6-6A19.5 19.5 0 0 1 1.5 4 2 2 0 0 1 3.5 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.5 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  shield: <path d="M12 3 4.5 6v6c0 4.8 3.2 8 7.5 9 4.3-1 7.5-4.2 7.5-9V6z" />,
  building: <path d="M4.5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M15.5 9h2a2 2 0 0 1 2 2v10M2.5 21h19M8 7h4M8 11h4M8 15h4" />,
  sliders: <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size; defaults to 20. */
  size?: number;
  /** Accessible name. Omit for decorative icons next to visible text (they are then aria-hidden). */
  title?: string;
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
