import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Element to render. A 'section' with a title is labelled by it. Default 'div'. */
  as?: 'div' | 'section' | 'article' | 'li';
  /** Heading shown in the card header (an h2; pass headingLevel 3 inside a titled section). */
  title?: ReactNode;
  headingLevel?: 2 | 3;
  /** Small text under the title. */
  subtitle?: ReactNode;
  /** Right side of the header (a link or small button). */
  actions?: ReactNode;
  /** Remove the inner padding (for edge-to-edge lists or maps). */
  flush?: boolean;
  /** Lighter look for nested or secondary panels. */
  muted?: boolean;
  children?: ReactNode;
}

/** Surface panel. With `title` it renders a header row; otherwise it is a plain padded box. */
export function Card({
  as: Tag = 'div',
  title,
  headingLevel = 2,
  subtitle,
  actions,
  flush,
  muted,
  className,
  children,
  ...rest
}: CardProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <Tag
      className={cx('card', flush && 'card--flush', muted && 'card--muted', className)}
      aria-labelledby={Tag === 'section' && title ? titleId : undefined}
      {...rest}
    >
      {title || actions ? (
        <header className="card__header">
          <div className="card__heading">
            {title ? (
              <Heading className="card__title" id={titleId}>
                {title}
              </Heading>
            ) : null}
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}
