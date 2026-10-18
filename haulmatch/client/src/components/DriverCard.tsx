import type { ReactNode } from 'react';
import type { DriverSummary, MatchResult } from '../../../shared/types';
import { cx } from '../lib/cx';
import { driverClassLabel, endorsementLabel, feet, lbs, miles, place, plural, rating } from '../lib/format';
import { Badge } from './Badge';
import { Avatar } from './DataDisplay';
import { EquipmentChips } from './Equipment';
import { Icon } from './Icon';
import { ScoreBadge } from './ScoreBadge';

export interface DriverCardProps {
  driver: DriverSummary;
  /** How well the load fits this driver (bookings and recommended drivers). */
  match?: MatchResult | null;
  /** Extra content under the facts, e.g. the request message or counter-offer. */
  children?: ReactNode;
  /** Buttons (Accept, Decline, Invite, Message). */
  actions?: ReactNode;
  className?: string;
}

/** A carrier at a glance for shippers: rig, capacity, CDL, rating, location, phone if shared. */
export function DriverCard({ driver, match, children, actions, className }: DriverCardProps) {
  return (
    <article className={cx('card', 'driver-card', className)}>
      <div className="driver-card__top">
        <Avatar name={driver.name} />
        <div className="driver-card__who">
          <h3 className="driver-card__name">{driver.name}</h3>
          <p className="driver-card__company">
            {[driver.company, driverClassLabel(driver.driverClass)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {match ? (
          <ScoreBadge score={match.score} eligible={match.eligible} size="sm" ineligibleLabel="Not a fit for this load" />
        ) : null}
      </div>

      <p className="driver-card__rig">{driver.truckDescription || 'Rig details not added yet'}</p>
      <EquipmentChips codes={driver.equipmentTypes} matched={match?.matchedEquipment} matchedLabel="fits this load" />

      <ul className="driver-card__facts">
        <li className="num">
          <Icon name="weight" size={16} />
          {lbs(driver.maxPayloadLbs)} max
        </li>
        <li className="num">
          <Icon name="ruler" size={16} />
          {feet(driver.trailerLengthFt)} deck
        </li>
        <li>
          <Icon name="shield" size={16} />
          {driver.hasCdl ? 'CDL' : 'Non-CDL'}
        </li>
        <li className="num">
          <Icon name="star" size={16} />
          {rating(driver.rating)}
          {driver.completedLoads > 0 ? ` · ${plural(driver.completedLoads, 'load')}` : ''}
        </li>
        <li>
          <Icon name="pin" size={16} />
          {driver.currentLocation ? place(driver.currentLocation) : 'Location not set'}
          {match?.deadheadMiles != null ? <span className="muted num"> ({miles(match.deadheadMiles)} out)</span> : null}
        </li>
        {driver.phone ? (
          <li>
            <Icon name="phone" size={16} />
            <a href={`tel:${driver.phone}`}>{driver.phone}</a>
          </li>
        ) : null}
      </ul>

      {driver.endorsements.length || driver.mcNumber || driver.dotNumber || !driver.available ? (
        <div className="driver-card__badges">
          {!driver.available ? <Badge tone="neutral">Not available</Badge> : null}
          {driver.endorsements.map((e) => (
            <Badge key={e} tone="info">
              {endorsementLabel(e)}
            </Badge>
          ))}
          {driver.mcNumber ? <Badge>MC {driver.mcNumber}</Badge> : null}
          {driver.dotNumber ? <Badge>DOT {driver.dotNumber}</Badge> : null}
        </div>
      ) : null}

      {children}
      {actions ? <div className="driver-card__actions">{actions}</div> : null}
    </article>
  );
}
