// Display formatting. Times render in the viewer's local time zone; pass `now` for testable output.
import { DRIVER_CLASSES, EQUIPMENT, MARKET_SNAPSHOT } from '../../../shared/equipment';
import { US_STATES } from '../../../shared/geo';
import type {
  BookingStatus,
  City,
  DriverClass,
  Endorsement,
  EquipmentCode,
  LoadStatus,
  Place,
} from '../../../shared/types';

const LOCALE = 'en-US';

const wholeDollars = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** $1,400 (whole dollars; pass `{ cents: true }` for $3.75). Negative values keep the sign: -$120. */
export function money(usd: number, opts: { cents?: boolean } = {}): string {
  return (opts.cents ? cents : wholeDollars).format(usd);
}

/** $2.66/mi */
export function ratePerMile(usdPerMile: number): string {
  return `${cents.format(usdPerMile)}/mi`;
}

/** 1,234 */
export function number(n: number): string {
  return integer.format(n);
}

/** 523 mi */
export function miles(n: number): string {
  return `${integer.format(n)} mi`;
}

/** 10,000 lbs */
export function lbs(n: number): string {
  return `${integer.format(n)} lbs`;
}

/** 40 ft */
export function feet(n: number): string {
  return `${integer.format(n)} ft`;
}

/** Odessa, TX. Accepts a Place, a City or null (renders an em dash). */
export function place(p: Place | City | null | undefined): string {
  if (!p) return '—';
  const name = 'city' in p ? p.city : p.name;
  return p.state ? `${name}, ${p.state}` : name;
}

/** Houston, TX → Odessa, TX */
export function lane(origin: Place | City, destination: Place | City): string {
  return `${place(origin)} → ${place(destination)}`;
}

export function stateName(code: string): string {
  return US_STATES[code] ?? code;
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const shortDateYearFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });

const DAY_MS = 86_400_000;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Whole calendar days from `now` to `date` in local time (0 = same day, 1 = tomorrow). */
export function calendarDayDiff(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / DAY_MS);
}

/** 2:00 PM */
export function clockTime(value: string | Date): string {
  return timeFmt.format(toDate(value));
}

/** "Today", "Tomorrow", "Yesterday", or "Wed, Oct 21" (with the year when it differs). */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  const diff = calendarDayDiff(date, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return (date.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt).format(date);
}

/** "Today 2:00 PM", "Tomorrow 8:00 AM", "Wed, Oct 21 8:00 AM". */
export function pickupTime(value: string | Date, now: Date = new Date()): string {
  return `${dayLabel(value, now)} ${clockTime(value)}`;
}

/** Alias of pickupTime for any date-time that should read relative to today. */
export const dateTime = pickupTime;

/**
 * A pickup or delivery window: "Today 2:00 PM – 6:00 PM" on one day,
 * "Today 2:00 PM – Tomorrow 8:00 AM" across days, a single time when start equals end.
 */
export function timeWindow(start: string | Date, end: string | Date | null | undefined, now: Date = new Date()): string {
  const s = toDate(start);
  if (!end) return pickupTime(s, now);
  const e = toDate(end);
  if (e.getTime() === s.getTime()) return pickupTime(s, now);
  const sameDay = calendarDayDiff(e, s) === 0;
  return `${pickupTime(s, now)} – ${sameDay ? clockTime(e) : pickupTime(e, now)}`;
}

/** Oct 21 (with the year when it differs from now). */
export function shortDate(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  return (date.getFullYear() === now.getFullYear() ? shortDateFmt : shortDateYearFmt).format(date);
}

/** "just now", "5m ago", "3h ago", "2d ago", then "Oct 3". Future times read "in 5m". */
export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  const diffMs = now.getTime() - date.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / DAY_MS);
  let span: string;
  if (minutes < 1) return 'just now';
  if (minutes < 60) span = `${minutes}m`;
  else if (hours < 24) span = `${hours}h`;
  else if (days < 7) span = `${days}d`;
  else return shortDate(date, now);
  return diffMs >= 0 ? `${span} ago` : `in ${span}`;
}

/** "in 3h", "in 2d", "now", "3h ago": compact countdown for pickups. */
export function relativeHours(value: string | Date, now: Date = new Date()): string {
  const diffH = (toDate(value).getTime() - now.getTime()) / 3_600_000;
  if (Math.abs(diffH) < 1) return 'now';
  const n = Math.abs(diffH) < 48 ? `${Math.round(Math.abs(diffH))}h` : `${Math.round(Math.abs(diffH) / 24)}d`;
  return diffH > 0 ? `in ${n}` : `${n} ago`;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

/** Month names as freight news writes them: "Sept 2026", "March 2026". */
const NEWS_MONTHS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

type MarketSnapshot = { asOf: string; dieselUsdPerGallon: number };

/** "Sept 2026" for MARKET_SNAPSHOT.asOf "2026-09". */
export function marketMonth(snapshot: Pick<MarketSnapshot, 'asOf'> = MARKET_SNAPSHOT): string {
  const m = /^(\d{4})-(\d{2})$/.exec(snapshot.asOf);
  const month = m ? NEWS_MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : snapshot.asOf;
}

/**
 * "Market data: DAT national averages, Sept 2026 · diesel $6.29": where the rate benchmarks and the
 * default diesel price come from, shown next to the rate estimate and the driver's money panel.
 */
export function marketDataLine(snapshot: MarketSnapshot = MARKET_SNAPSHOT): string {
  return `Market data: DAT national averages, ${marketMonth(snapshot)} · diesel ${money(snapshot.dieselUsdPerGallon, { cents: true })}`;
}

// ---------------------------------------------------------------------------
// Domain labels
// ---------------------------------------------------------------------------

/** "Hotshot gooseneck flatbed" */
export function equipmentLabel(code: EquipmentCode): string {
  return EQUIPMENT[code]?.label ?? code;
}

/** "Gooseneck" */
export function equipmentShortLabel(code: EquipmentCode): string {
  return EQUIPMENT[code]?.shortLabel ?? code;
}

/** "Gooseneck, Flatbed" (or "Gooseneck or Flatbed" with joiner ' or '). */
export function equipmentList(codes: EquipmentCode[], joiner = ', '): string {
  return codes.map(equipmentShortLabel).join(joiner);
}

export function driverClassLabel(driverClass: DriverClass): string {
  return DRIVER_CLASSES[driverClass]?.label ?? driverClass;
}

const ENDORSEMENT_LABELS: Record<Endorsement, string> = {
  hazmat: 'Hazmat (H)',
  tanker: 'Tanker (N)',
  doubles_triples: 'Doubles/triples (T)',
  twic: 'TWIC card',
};

export function endorsementLabel(e: Endorsement): string {
  return ENDORSEMENT_LABELS[e] ?? e;
}

const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  open: 'Open',
  booked: 'Booked',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

export function loadStatusLabel(status: LoadStatus): string {
  return LOAD_STATUS_LABELS[status] ?? status;
}

export function bookingStatusLabel(status: BookingStatus): string {
  return BOOKING_STATUS_LABELS[status] ?? status;
}

export type ScoreTier = 'great' | 'good' | 'fair' | 'weak' | 'none';

/** Score bands used by ScoreBadge and anywhere a score is described in words. */
export function scoreTier(score: number, eligible = true): ScoreTier {
  if (!eligible) return 'none';
  if (score >= 85) return 'great';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'weak';
}

const TIER_LABELS: Record<ScoreTier, string> = {
  great: 'Great match',
  good: 'Good match',
  fair: 'Fair match',
  weak: 'Weak match',
  none: 'Not a fit',
};

/** "Great match", "Good match", "Fair match", "Weak match", "Not a fit". */
export function scoreLabel(score: number, eligible = true): string {
  return TIER_LABELS[scoreTier(score, eligible)];
}

/** "1 request", "3 requests" */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${integer.format(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Up to two initials for an avatar: "Jess Ortiz" -> "JO". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** 4.8 ★ style rating; "New" when the driver has no rating yet. */
export function rating(value: number): string {
  return value > 0 ? value.toFixed(1) : 'New';
}
