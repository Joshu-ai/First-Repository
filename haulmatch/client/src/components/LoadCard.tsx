import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Load, MatchResult } from '../../../shared/types';
import { cx } from '../lib/cx';
import { feet, lbs, miles, money, pickupTime, place, plural, ratePerMile, scoreLabel, scoreTier } from '../lib/format';
import { Badge, StatusBadge, Tag } from './Badge';
import { EquipmentChips } from './Equipment';
import { Icon } from './Icon';
import { ScoreBadge } from './ScoreBadge';

export interface LoadCardProps {
  load: Load;
  /** The viewer's match. Drivers pass load.match; omit or null for shippers or incomplete profiles. */
  match?: MatchResult | null;
  /** Makes the whole card a link (the lane is the link text; `actions` stay separately clickable). */
  href?: string;
  /** Buttons rendered in the card footer (Book, Request, Message...). */
  actions?: ReactNode;
  /**
   * driver (default): match score, money, deadhead, profit, highlights.
   * compact: one dense block for shipper lists, with status and pending request count.
   */
  variant?: 'driver' | 'compact';
  /** Reference time for "Today 2:00 PM" labels. */
  now?: Date;
  /** Show the shipper/company line (driver variant). Default true. */
  showShipper?: boolean;
  /** Visually mark the card (e.g. selected on the map). */
  selected?: boolean;
  className?: string;
}

/** The load list item. The match score leads, then lane, money, deadhead and pickup. */
export function LoadCard(props: LoadCardProps) {
  return props.variant === 'compact' ? <CompactLoadCard {...props} /> : <DriverLoadCard {...props} />;
}

function LaneTitle({ load, href }: { load: Load; href?: string }) {
  const content = (
    <>
      <span className="lane__city">{place(load.origin)}</span>
      <span className="lane__arrow" aria-label="to">
        <Icon name="arrowRight" size={16} />
      </span>
      <span className="lane__city">{place(load.destination)}</span>
    </>
  );
  return (
    <h3 className="load-card__lane lane">
      {href ? (
        <Link to={href} className="load-card__link">
          {content}
        </Link>
      ) : (
        content
      )}
    </h3>
  );
}

function LoadFlags({ load }: { load: Load }) {
  const flags: ReactNode[] = [];
  if (load.bookingMode === 'instant') {
    flags.push(
      <Badge key="instant" tone="brand" icon="bolt">
        Instant book
      </Badge>,
    );
  }
  if (load.hazmat) {
    flags.push(
      <Badge key="hazmat" tone="bad" icon="hazard">
        Hazmat
      </Badge>,
    );
  }
  if (load.tarpRequired) {
    flags.push(
      <Badge key="tarp" tone="warn" icon="tarp">
        Tarp
      </Badge>,
    );
  }
  if (load.teamRequired) {
    flags.push(
      <Badge key="team" tone="info" icon="users">
        Team
      </Badge>,
    );
  }
  if (load.loadSize === 'partial') {
    flags.push(
      <Badge key="partial" tone="neutral">
        Partial
      </Badge>,
    );
  }
  return flags.length ? <div className="load-card__flags">{flags}</div> : null;
}

function DriverLoadCard({ load, match, href, actions, now, showShipper = true, selected, className }: LoadCardProps) {
  const reference = now ?? new Date();
  const failed = match && !match.eligible ? match.checks.filter((c) => c.hard && !c.ok) : [];
  return (
    <article
      className={cx(
        'card',
        'load-card',
        href && 'load-card--linked',
        selected && 'load-card--selected',
        match && !match.eligible && 'load-card--ineligible',
        className,
      )}
    >
      <div className="load-card__top">
        {match ? <ScoreBadge score={match.score} eligible={match.eligible} size="md" showLabel={false} /> : null}
        <div className="load-card__main">
          <LaneTitle load={load} href={href} />
          <p className="load-card__commodity" title={load.commodity}>
            {load.commodity}
          </p>
          <p className="load-card__sub">
            <span className="visually-hidden">Pickup </span>
            {pickupTime(load.pickupStart, reference)}
          </p>
          {match ? (
            <p className={cx('load-card__tier', `tier--${scoreTier(match.score, match.eligible)}`)}>
              {match.eligible ? `${scoreLabel(match.score)} · ${match.score}` : 'Not a fit for your rig'}
            </p>
          ) : null}
        </div>
        <div className="load-card__money">
          <span className="load-card__rate num">{money(load.rateUsd)}</span>
          <span className="load-card__rpm num">{ratePerMile(load.ratePerMile)}</span>
          <span className="load-card__miles num">{miles(load.miles)}</span>
        </div>
      </div>

      {match ? (
        <dl className="load-card__metrics">
          <div>
            <dt>Deadhead</dt>
            <dd className="num">{match.deadheadMiles === null ? '—' : miles(match.deadheadMiles)}</dd>
          </div>
          <div>
            <dt>All-in</dt>
            <dd className="num">{ratePerMile(match.effectiveRatePerMile)}</dd>
          </div>
          <div>
            <dt>Est. profit</dt>
            <dd className={cx('num', match.estimatedProfitUsd < 0 && 'text-bad')}>{money(match.estimatedProfitUsd)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="load-card__specs">
        <EquipmentChips codes={load.equipmentTypes} matched={match?.matchedEquipment} max={3} />
        <span className="load-card__size num">
          {lbs(load.weightLbs)} · {feet(load.lengthFt)}
        </span>
      </div>

      {failed.length ? (
        <ul className="load-card__problems">
          {failed.slice(0, 2).map((c) => (
            <li key={c.key}>
              <Icon name="x" size={16} />
              {c.label}
            </li>
          ))}
        </ul>
      ) : match?.highlights.length ? (
        <ul className="load-card__highlights" aria-label="Highlights">
          {match.highlights.slice(0, 3).map((h) => (
            <li key={h}>
              <Icon name="star" size={14} />
              {h}
            </li>
          ))}
        </ul>
      ) : null}

      <LoadFlags load={load} />

      {showShipper || actions ? (
        <div className="load-card__footer">
          {showShipper ? (
            <span className="load-card__shipper">
              <Icon name="building" size={16} />
              {load.shipperCompany ?? load.shipperName}
            </span>
          ) : (
            <span />
          )}
          {actions ? <div className="load-card__actions">{actions}</div> : null}
        </div>
      ) : null}
    </article>
  );
}

function CompactLoadCard({ load, href, actions, now, selected, className }: LoadCardProps) {
  const reference = now ?? new Date();
  return (
    <article
      className={cx(
        'card',
        'load-card',
        'load-card--compact',
        href && 'load-card--linked',
        selected && 'load-card--selected',
        className,
      )}
    >
      <div className="load-card__top">
        <div className="load-card__main">
          <LaneTitle load={load} href={href} />
          <p className="load-card__sub">
            <span className="nowrap">{pickupTime(load.pickupStart, reference)}</span>
            <span aria-hidden="true"> · </span>
            <span className="num">{miles(load.miles)}</span>
            <span aria-hidden="true"> · </span>
            <span className="num">{lbs(load.weightLbs)}</span>
          </p>
        </div>
        <div className="load-card__money">
          <span className="load-card__rate num">{money(load.bookedRateUsd ?? load.rateUsd)}</span>
          <span className="load-card__rpm num">{ratePerMile(load.ratePerMile)}</span>
        </div>
      </div>
      <div className="load-card__specs">
        <StatusBadge kind="load" status={load.status} />
        {load.pendingRequestCount > 0 ? (
          <Badge tone="warn" solid icon="users">
            {plural(load.pendingRequestCount, 'request')}
          </Badge>
        ) : null}
        <EquipmentChips codes={load.equipmentTypes} max={2} />
        {load.referenceNumber ? <Tag>Ref {load.referenceNumber}</Tag> : null}
      </div>
      <LoadFlags load={load} />
      {actions ? (
        <div className="load-card__footer">
          <span />
          <div className="load-card__actions">{actions}</div>
        </div>
      ) : null}
    </article>
  );
}
