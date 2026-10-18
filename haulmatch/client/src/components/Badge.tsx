import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { BookingStatus, LoadStatus } from '../../../shared/types';
import { cx } from '../lib/cx';
import { bookingStatusLabel, loadStatusLabel } from '../lib/format';
import { Icon, type IconName } from './Icon';

export type Tone = 'neutral' | 'brand' | 'info' | 'ok' | 'warn' | 'bad';

export interface BadgeProps {
  tone?: Tone;
  icon?: IconName;
  /** Solid fill instead of the soft tint (counts, urgent flags). */
  solid?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** Small status/flag label. Always has text, so color is never the only signal. */
export function Badge({ tone = 'neutral', icon, solid, className, title, children }: BadgeProps) {
  return (
    <span className={cx('badge', `badge--${tone}`, solid && 'badge--solid', className)} title={title}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** Toggle chips set aria-pressed; omit `selected` for a plain clickable chip. */
  selected?: boolean;
  icon?: IconName;
  /** Shows a remove (x) affordance; use for removable filter chips. */
  removable?: boolean;
  children: ReactNode;
}

/** Pill-shaped button for filters and quick choices (min 44px tall touch target). */
export function Chip({ selected, icon, removable, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      className={cx('chip', selected && 'chip--selected', removable && 'chip--removable', className)}
      aria-pressed={selected === undefined ? undefined : selected}
      {...rest}
    >
      {selected && !icon ? <Icon name="check" size={16} /> : icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
      {removable ? <Icon name="x" size={16} /> : null}
    </button>
  );
}

/** A non-interactive pill (equipment tags, highlights). */
export function Tag({ tone = 'neutral', icon, className, children }: Omit<BadgeProps, 'solid'>) {
  return (
    <span className={cx('tag', `tag--${tone}`, className)}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

const LOAD_TONES: Record<LoadStatus, Tone> = {
  open: 'brand',
  booked: 'info',
  in_transit: 'warn',
  delivered: 'ok',
  cancelled: 'neutral',
};

const BOOKING_TONES: Record<BookingStatus, Tone> = {
  pending: 'warn',
  accepted: 'ok',
  declined: 'bad',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};

const LOAD_ICONS: Record<LoadStatus, IconName> = {
  open: 'dot',
  booked: 'check',
  in_transit: 'truck',
  delivered: 'check',
  cancelled: 'x',
};

const BOOKING_ICONS: Record<BookingStatus, IconName> = {
  pending: 'clock',
  accepted: 'check',
  declined: 'x',
  withdrawn: 'arrowLeft',
  cancelled: 'x',
};

export type StatusBadgeProps =
  | { kind: 'load'; status: LoadStatus; className?: string }
  | { kind: 'booking'; status: BookingStatus; className?: string };

/** Load status (Open / Booked / In transit / Delivered / Cancelled) or booking status (Pending / Accepted / ...). */
export function StatusBadge(props: StatusBadgeProps) {
  if (props.kind === 'load') {
    return (
      <Badge tone={LOAD_TONES[props.status]} icon={LOAD_ICONS[props.status]} className={props.className}>
        {loadStatusLabel(props.status)}
      </Badge>
    );
  }
  return (
    <Badge tone={BOOKING_TONES[props.status]} icon={BOOKING_ICONS[props.status]} className={props.className}>
      {bookingStatusLabel(props.status)}
    </Badge>
  );
}

/** Red count bubble (unread, pending requests). Hidden when count is 0. */
export function CountBubble({ count, label, className }: { count: number; label?: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cx('count-bubble', className)} aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
