import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLookProps {
  /** primary = safety orange (one per view), secondary = outlined, ghost = text only, danger = destructive. */
  variant?: ButtonVariant;
  /** sm = 36px (dense desktop lists only), md = 44px (default), lg = 52px (primary thumb actions). */
  size?: ButtonSize;
  /** Stretch to the container width (mobile primary actions). */
  block?: boolean;
  /** Icon shown before the label. */
  icon?: IconName;
  /** Icon shown after the label. */
  iconAfter?: IconName;
}

function buttonClass({ variant = 'primary', size = 'md', block }: ButtonLookProps, extra?: string, iconOnly?: boolean) {
  return cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', iconOnly && 'btn--icon', extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonLookProps {
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  children?: ReactNode;
}

/** Defaults to type="button" so it never submits a form by accident; pass type="submit" explicitly. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, icon, iconAfter, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = !children && Boolean(icon);
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, block }, className, iconOnly)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 18} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children ? <span className="btn__label">{children}</span> : null}
      {iconAfter && !loading ? <Icon name={iconAfter} size={size === 'sm' ? 16 : 20} /> : null}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps, ButtonLookProps {}

/** A react-router Link that looks like a Button. */
export function ButtonLink({ variant, size, block, icon, iconAfter, className, children, ...rest }: ButtonLinkProps) {
  const iconOnly = !children && Boolean(icon);
  return (
    <Link className={buttonClass({ variant, size, block }, className, iconOnly)} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children ? <span className="btn__label">{children}</span> : null}
      {iconAfter ? <Icon name={iconAfter} size={size === 'sm' ? 16 : 20} /> : null}
    </Link>
  );
}

export interface ButtonAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonLookProps {}

/** A plain <a> (tel:, mailto:, external) that looks like a Button. */
export function ButtonAnchor({ variant, size, block, icon, iconAfter, className, children, ...rest }: ButtonAnchorProps) {
  const iconOnly = !children && Boolean(icon);
  return (
    <a className={buttonClass({ variant, size, block }, className, iconOnly)} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children ? <span className="btn__label">{children}</span> : null}
      {iconAfter ? <Icon name={iconAfter} size={size === 'sm' ? 16 : 20} /> : null}
    </a>
  );
}
