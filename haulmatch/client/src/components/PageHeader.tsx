import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/cx';
import { useDocumentTitle } from '../lib/hooks';
import { Icon } from './Icon';

export interface PageHeaderProps {
  /** The page's h1. When it is a string it also becomes the browser tab title. */
  title: ReactNode;
  /** Tab title when `title` is not a plain string. */
  documentTitle?: string;
  subtitle?: ReactNode;
  /** Small label above the title ("Load HM-1042"). */
  eyebrow?: ReactNode;
  /** Back link shown above the title. */
  back?: { to: string; label: string };
  /** Buttons on the right (stack under the title on phones). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, documentTitle, subtitle, eyebrow, back, actions, className }: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : null));
  return (
    <header className={cx('page-header', className)}>
      {back ? (
        <Link to={back.to} className="page-header__back">
          <Icon name="chevronLeft" size={18} />
          {back.label}
        </Link>
      ) : null}
      <div className="page-header__row">
        <div className="page-header__text">
          {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="page-header__title">{title}</h1>
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
