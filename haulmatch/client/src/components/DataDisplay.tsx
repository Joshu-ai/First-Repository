import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/cx';
import { initials } from '../lib/format';
import type { Tone } from './Badge';
import { Icon, type IconName } from './Icon';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small line under the value ("2 waiting on you"). */
  hint?: ReactNode;
  icon?: IconName;
  tone?: Tone;
  /** Makes the tile a link (dashboard filters). */
  to?: string;
  className?: string;
}

/** A big number with a label, for dashboards (ShipperStats, DriverStats). */
export function StatTile({ label, value, hint, icon, tone = 'neutral', to, className }: StatTileProps) {
  const body = (
    <>
      <span className="stat__label">
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </span>
      <span className="stat__value num">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </>
  );
  const classes = cx('stat', `stat--${tone}`, to && 'stat--link', className);
  return to ? (
    <Link to={to} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Responsive grid of StatTiles: 2 columns on phones, up to 4 on desktop. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('stat-grid', className)}>{children}</div>;
}

export interface DetailItem {
  label: ReactNode;
  value: ReactNode;
  /** Bold row (totals). */
  strong?: boolean;
}

/** Label/value rows (load facts, profile summary). Values are tabular numbers. */
export function DetailList({ items, columns = 1, className }: { items: DetailItem[]; columns?: 1 | 2; className?: string }) {
  return (
    <dl className={cx('detail-list', columns === 2 && 'detail-list--2col', className)}>
      {items.map((item, i) => (
        <div key={i} className={cx('detail-list__row', item.strong && 'detail-list__row--strong')}>
          <dt>{item.label}</dt>
          <dd className="num">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Initials in a circle. Decorative: the name should be visible next to it. */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span className={cx('avatar', `avatar--${size}`, className)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
