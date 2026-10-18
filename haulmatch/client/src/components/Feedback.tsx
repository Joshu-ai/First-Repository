// Loading, empty and error states. Every list should use all three.
import type { CSSProperties, ReactNode } from 'react';
import { errorMessage, isApiError } from '../lib/api';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export interface SpinnerProps {
  size?: number;
  /** Announced to screen readers. Omit when the spinner sits inside a labelled busy button. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 20, label, className }: SpinnerProps) {
  return (
    <span
      className={cx('spinner', className)}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Centered spinner with text, for a whole page or panel that is loading. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <Spinner size={28} />
      <span className="muted">{label}</span>
    </div>
  );
}

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  /** Render several text-line bars. */
  lines?: number;
  radius?: CSSProperties['borderRadius'];
  className?: string;
}

/** Shimmering placeholder block. Decorative: wrap a group of skeletons in an element with aria-busy. */
export function Skeleton({ width = '100%', height = 14, lines, radius, className }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <span className={cx('skeleton-lines', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="skeleton"
            style={{ width: i === lines - 1 ? '60%' : width, height, borderRadius: radius }}
          />
        ))}
      </span>
    );
  }
  return <span className={cx('skeleton', className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** Placeholder shaped like a LoadCard; render 3–5 of these while a load list is loading. */
export function LoadCardSkeleton() {
  return (
    <div className="card load-card load-card--skeleton" aria-hidden="true">
      <div className="load-card__top">
        <Skeleton width={56} height={56} radius="50%" />
        <div className="load-card__main">
          <Skeleton width="70%" height={18} />
          <Skeleton width="45%" height={14} />
        </div>
        <div className="load-card__money">
          <Skeleton width={64} height={20} />
          <Skeleton width={52} height={14} />
        </div>
      </div>
      <Skeleton lines={2} />
    </div>
  );
}

/** A list of LoadCard skeletons with a busy label for assistive tech. */
export function LoadListSkeleton({ count = 4, label = 'Loading loads' }: { count?: number; label?: string }) {
  return (
    <div className="stack" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: count }, (_, i) => (
        <LoadCardSkeleton key={i} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  /** Usually a Button or ButtonLink. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = 'boxes', title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('empty-state', className)}>
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      {children ? <div className="empty-state__body">{children}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  /** The thrown value; ApiError messages are shown as-is, network errors get friendly copy. */
  error: unknown;
  title?: string;
  onRetry?: () => void;
  /** Smaller inline variant for a panel inside a page. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({ error, title, onRetry, compact, className }: ErrorStateProps) {
  const notFound = isApiError(error) && error.status === 404;
  const heading = title ?? (notFound ? 'Not found' : 'Couldn’t load this');
  return (
    <div className={cx('error-state', compact && 'error-state--compact', className)} role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <Icon name="warning" size={compact ? 20 : 28} />
      </span>
      <div className="error-state__text">
        <h2 className="error-state__title">{heading}</h2>
        <p className="error-state__body">{errorMessage(error)}</p>
      </div>
      {onRetry && !notFound ? (
        <button type="button" className="btn btn--secondary btn--md" onClick={onRetry}>
          <Icon name="refresh" size={18} />
          <span className="btn__label">Try again</span>
        </button>
      ) : null}
    </div>
  );
}

export interface InlineAlertProps {
  tone?: 'info' | 'ok' | 'warn' | 'bad';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A callout box inside a page or form ("Finish your rig profile to see matches"). */
export function InlineAlert({ tone = 'info', title, children, action, className }: InlineAlertProps) {
  const icon: IconName = tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'warning';
  return (
    <div className={cx('alert', `alert--${tone}`, className)} role={tone === 'bad' ? 'alert' : undefined}>
      <span className="alert__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className="alert__content">
        {title ? <p className="alert__title">{title}</p> : null}
        {children ? <div className="alert__body">{children}</div> : null}
      </div>
      {action ? <div className="alert__action">{action}</div> : null}
    </div>
  );
}
