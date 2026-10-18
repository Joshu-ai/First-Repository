import type { Load } from '../../../../../shared/types';
import { Icon, type IconName } from '../../../components/Icon';
import { cx } from '../../../lib/cx';
import { pickupTime, plural, timeWindow } from '../../../lib/format';

type StepState = 'done' | 'current' | 'upcoming' | 'cancelled';

interface Step {
  key: string;
  title: string;
  /** When it happened, or what is expected next. */
  detail: string | null;
  state: StepState;
}

const STATE_ICON: Record<StepState, IconName> = {
  done: 'check',
  current: 'clock',
  upcoming: 'dot',
  cancelled: 'x',
};

const STATE_TEXT: Record<StepState, string> = {
  done: 'Done',
  current: 'Up next',
  upcoming: 'Not yet',
  cancelled: 'Cancelled',
};

const PROGRESS: Record<Load['status'], number> = { open: 0, booked: 1, in_transit: 2, delivered: 3, cancelled: -1 };

function buildSteps(load: Load, bookedAt: string | null, now: Date): Step[] {
  const posted: Step = { key: 'posted', title: 'Posted', detail: pickupTime(load.createdAt, now), state: 'done' };
  if (load.status === 'cancelled') {
    return [posted, { key: 'cancelled', title: 'Cancelled', detail: pickupTime(load.updatedAt, now), state: 'cancelled' }];
  }
  const progress = PROGRESS[load.status];
  const stateFor = (index: number): StepState => (progress >= index ? 'done' : progress + 1 === index ? 'current' : 'upcoming');

  const waiting =
    load.pendingRequestCount > 0 ? `${plural(load.pendingRequestCount, 'request')} waiting on you` : 'Waiting for a driver';
  const deliverBy = load.deliveryBy ? `Deliver by ${pickupTime(load.deliveryBy, now)}` : null;

  return [
    posted,
    {
      key: 'booked',
      title: 'Booked',
      detail: progress >= 1 ? (bookedAt ? pickupTime(bookedAt, now) : null) : waiting,
      state: stateFor(1),
    },
    {
      key: 'picked_up',
      title: 'Picked up',
      detail: load.pickedUpAt ? pickupTime(load.pickedUpAt, now) : `Pickup ${timeWindow(load.pickupStart, load.pickupEnd, now)}`,
      state: stateFor(2),
    },
    {
      key: 'delivered',
      title: 'Delivered',
      detail: load.deliveredAt ? pickupTime(load.deliveredAt, now) : deliverBy,
      state: stateFor(3),
    },
  ];
}

export interface StatusTimelineProps {
  load: Load;
  /** When the booking was accepted (the load has no booked-at column of its own). */
  bookedAt: string | null;
  now: Date;
}

/** Posted → booked → picked up → delivered, with times as they happen. */
export function StatusTimeline({ load, bookedAt, now }: StatusTimelineProps) {
  const steps = buildSteps(load, bookedAt, now);
  return (
    <ol className="sh-timeline" aria-label="Load progress">
      {steps.map((step) => (
        <li
          key={step.key}
          className={cx('sh-timeline__step', `sh-timeline__step--${step.state}`)}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="sh-timeline__marker" aria-hidden="true">
            <Icon name={STATE_ICON[step.state]} size={step.state === 'upcoming' ? 10 : 16} />
          </span>
          <div className="sh-timeline__body">
            <p className="sh-timeline__title">
              {step.title}
              <span className="visually-hidden">: {STATE_TEXT[step.state]}</span>
            </p>
            {step.detail ? <p className="sh-timeline__time">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
