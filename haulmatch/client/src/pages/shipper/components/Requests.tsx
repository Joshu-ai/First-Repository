import { useId } from 'react';
import { Link } from 'react-router';
import type { Booking, Load } from '../../../../../shared/types';
import { Badge, StatusBadge } from '../../../components/Badge';
import { Button, ButtonLink } from '../../../components/Button';
import { Avatar } from '../../../components/DataDisplay';
import { DriverCard } from '../../../components/DriverCard';
import { Icon } from '../../../components/Icon';
import { MatchChecks } from '../../../components/MatchDetails';
import { ScoreBadge } from '../../../components/ScoreBadge';
import { driverClassLabel, lane, money, ratePerMile, timeAgo } from '../../../lib/format';
import { paths } from '../../../lib/routes';
import { acceptBlocker, shipperChecks, shipperMatchLine } from './shipperChecks';

type OfferLoad = Pick<Load, 'rateUsd' | 'miles'>;

/** "Takes your posted $1,400" or "Counter-offer $1,550 · $150 over your $1,400". */
export function OfferLine({ booking, load }: { booking: Booking; load: OfferLoad }) {
  const offer = booking.offerRateUsd;
  if (offer === null || offer === load.rateUsd) {
    return (
      <p className="row text-sm">
        <Icon name="dollar" size={16} className="muted" />
        <span>
          Takes your posted rate <strong className="num">{money(load.rateUsd)}</strong>
        </span>
      </p>
    );
  }
  const diff = offer - load.rateUsd;
  return (
    <p className="row">
      <Badge tone={diff > 0 ? 'warn' : 'ok'} icon="dollar">
        Counter-offer
      </Badge>
      <strong className="num">{money(offer)}</strong>
      <span className="muted text-sm num">
        {diff > 0 ? `${money(diff)} over` : `${money(-diff)} under`} your {money(load.rateUsd)} ·{' '}
        {ratePerMile(offer / Math.max(1, load.miles))}
      </span>
    </p>
  );
}

export interface RequestCardProps {
  booking: Booking;
  load: Load;
  /** Accept/Decline are offered only for pending requests on an open load. */
  canDecide: boolean;
  /** This request's decision is being sent. */
  busy: boolean;
  /** Another request's decision is being sent; hold these buttons. */
  locked: boolean;
  onAccept: () => void;
  onDecline: () => void;
  now: Date;
}

/** One booking request on the load detail page: the full driver card plus offer, note and checks. */
export function RequestCard({ booking, load, canDecide, busy, locked, onAccept, onDecline, now }: RequestCardProps) {
  const blockedId = useId();
  const driver = booking.driver;
  if (!driver) {
    return (
      <div className="card card--muted row">
        <StatusBadge kind="booking" status={booking.status} />
        <span className="muted">This driver’s account is no longer available.</span>
      </div>
    );
  }
  const first = driver.name.split(' ')[0];
  const blocked = canDecide ? acceptBlocker(booking) : null;
  const actions = (
    <>
      {canDecide ? (
        <>
          <Button
            icon="check"
            loading={busy}
            disabled={locked || blocked !== null}
            onClick={onAccept}
            aria-label={`Accept ${driver.name}`}
            aria-describedby={blocked ? blockedId : undefined}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            icon="x"
            disabled={busy || locked}
            onClick={onDecline}
            aria-label={`Decline ${driver.name}`}
          >
            Decline
          </Button>
        </>
      ) : null}
      <ButtonLink to={paths.thread(load.id, driver.userId)} variant="ghost" icon="message" aria-label={`Message ${driver.name}`}>
        Message
      </ButtonLink>
    </>
  );

  return (
    <DriverCard driver={driver} match={booking.match} actions={actions}>
      <div className="row">
        <StatusBadge kind="booking" status={booking.status} />
        <span className="muted text-sm">
          {booking.status === 'pending' ? 'Requested' : 'Updated'} {timeAgo(booking.status === 'pending' ? booking.createdAt : booking.updatedAt, now)}
        </span>
      </div>
      <OfferLine booking={booking} load={load} />
      {blocked ? (
        <p className="row text-sm text-bad" id={blockedId}>
          <Icon name="warning" size={16} />
          <span>{blocked}</span>
        </p>
      ) : null}
      {booking.message ? (
        <blockquote className="sh-quote">
          <span className="visually-hidden">{first} wrote: </span>
          {booking.message}
        </blockquote>
      ) : null}
      {booking.match ? (
        <MatchChecks checks={shipperChecks(load, driver, booking.match)} onlyImportant />
      ) : (
        <p className="muted text-sm">{first} hasn’t finished their rig profile, so there’s no match score yet.</p>
      )}
    </DriverCard>
  );
}

export interface RequestRowProps {
  /** A pending booking from GET /api/bookings (carries `load`, `driver` and `match`). */
  booking: Booking & { load: Load };
  busy: boolean;
  locked: boolean;
  onAccept: () => void;
  onDecline: () => void;
  now: Date;
}

/** Compact request for the dashboard panel: who, which load, the offer, and Accept / Decline. */
export function RequestRow({ booking, busy, locked, onAccept, onDecline, now }: RequestRowProps) {
  const blockedId = useId();
  const { load, driver, match } = booking;
  const blocked = acceptBlocker(booking);
  // The row has no checklist, so name the check that fails.
  const failed = blocked && match && driver ? shipperChecks(load, driver, match).find((c) => c.hard && !c.ok) : undefined;
  const name = driver?.name ?? 'Driver';
  const offer = booking.offerRateUsd;
  const countered = offer !== null && offer !== load.rateUsd;
  return (
    <li className="sh-request">
      <div className="row row-nowrap">
        {match ? (
          <ScoreBadge score={match.score} eligible={match.eligible} size="sm" ineligibleLabel="Not a fit for this load" />
        ) : (
          <Avatar name={name} />
        )}
        <div className="grow">
          <p className="strong truncate">{name}</p>
          <p className="muted text-sm truncate">
            {driver ? driver.truckDescription || `${driverClassLabel(driver.driverClass)} driver` : 'Rig unknown'}
          </p>
        </div>
        <div className="sh-request__money">
          <span className="strong num">{money(offer ?? load.rateUsd)}</span>
          <span className="muted text-xs">{countered ? `Counter (you: ${money(load.rateUsd)})` : 'Your rate'}</span>
        </div>
      </div>
      <Link className="sh-request__lane" to={paths.shipperLoad(load.id)}>
        {lane(load.origin, load.destination)}
      </Link>
      <p className="muted text-sm">
        {shipperMatchLine(match)} · {timeAgo(booking.createdAt, now)}
      </p>
      {booking.message ? <p className="sh-quote">{booking.message}</p> : null}
      {blocked ? (
        <p className="row row-nowrap text-sm text-bad" id={blockedId}>
          <Icon name="warning" size={16} />
          <span>{failed ? `${blocked}: ${failed.label.charAt(0).toLowerCase()}${failed.label.slice(1)}` : blocked}</span>
        </p>
      ) : null}
      <div className="sh-request__actions">
        <Button
          size="sm"
          icon="check"
          loading={busy}
          disabled={locked || blocked !== null}
          onClick={onAccept}
          aria-label={`Accept ${name}`}
          aria-describedby={blocked ? blockedId : undefined}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="x"
          disabled={busy || locked}
          onClick={onDecline}
          aria-label={`Decline ${name}`}
        >
          Decline
        </Button>
      </div>
    </li>
  );
}
