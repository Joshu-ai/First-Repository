import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Booking, DriverStats, Load } from '../../../../shared/types';
import { StatusBadge, Tag } from '../../components/Badge';
import { ButtonLink } from '../../components/Button';
import { StatGrid, StatTile } from '../../components/DataDisplay';
import { EquipmentChips } from '../../components/Equipment';
import { EmptyState, ErrorState, LoadListSkeleton, Skeleton } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs } from '../../components/Tabs';
import { api } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { miles, money, number, pickupTime, place, ratePerMile, shortDate, timeAgo, timeWindow } from '../../lib/format';
import { useApi, useNow, type AsyncState } from '../../lib/hooks';
import { useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import { TripStatusButton, WithdrawButton } from './components/TripActions';
import { useCoalesced, useRefreshOnFocus } from './components/useRefreshOnFocus';
import './components/driver.css';

type TabId = 'active' | 'requests' | 'history';
const TAB_IDS: TabId[] = ['active', 'requests', 'history'];

interface Trip {
  booking: Booking;
  load: Load;
}

interface TripGroups {
  active: Trip[];
  requests: Trip[];
  history: Trip[];
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/** Splits my bookings into what is on my truck, what is waiting on a shipper, and the rest. */
function groupTrips(bookings: Booking[], userId: string): TripGroups {
  const groups: TripGroups = { active: [], requests: [], history: [] };
  for (const booking of bookings) {
    const load = booking.load;
    if (!load) continue;
    const onMyTruck =
      booking.status === 'accepted' && load.bookedDriverId === userId && (load.status === 'booked' || load.status === 'in_transit');
    if (onMyTruck) groups.active.push({ booking, load });
    else if (booking.status === 'pending') groups.requests.push({ booking, load });
    else groups.history.push({ booking, load });
  }
  // In transit first (it needs "Delivered" next), then by pickup time.
  groups.active.sort(
    (a, b) => Number(b.load.status === 'in_transit') - Number(a.load.status === 'in_transit') || time(a.load.pickupStart) - time(b.load.pickupStart),
  );
  groups.requests.sort((a, b) => time(a.load.pickupStart) - time(b.load.pickupStart));
  groups.history.sort(
    (a, b) => time(b.load.deliveredAt ?? b.booking.updatedAt) - time(a.load.deliveredAt ?? a.booking.updatedAt),
  );
  return groups;
}

export default function TripsPage() {
  const user = useSignedInUser();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabId | null;
  const bookings = useApi((signal) => api.bookings.list(undefined, { signal }), []);
  const stats = useApi((signal) => api.drivers.myStats({ signal }), []);

  const reloadAll = () => {
    void bookings.reload();
    void stats.reload();
  };
  const reloadSoon = useCoalesced(reloadAll);
  useServerEvent((e) => {
    if (e.type === 'booking_updated' || e.type === 'load_updated') reloadSoon();
    else if (e.type === 'notification' && e.notification.type !== 'message' && e.notification.type !== 'load_match') reloadSoon();
  });
  useRefreshOnFocus(reloadAll);

  const groups = useMemo(() => groupTrips(bookings.data ?? [], user.id), [bookings.data, user.id]);
  // With nothing on the truck, open on the requests waiting for an answer.
  const fallback: TabId = bookings.data && groups.active.length === 0 && groups.requests.length > 0 ? 'requests' : 'active';
  const tab: TabId = requested && TAB_IDS.includes(requested) ? requested : fallback;
  const setTab = (next: TabId) => {
    const search = new URLSearchParams(params);
    search.set('tab', next);
    setParams(search, { replace: true });
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="My trips"
        subtitle="Loads on your truck, requests waiting on shippers, and everything you’ve hauled."
        actions={
          <ButtonLink to={paths.driverLoads} variant="secondary" icon="boxes">
            Find loads
          </ButtonLink>
        }
      />

      <TripStats state={stats} />

      <div>
        <Tabs
          id="trips"
          label="Trips"
          fill
          tabs={[
            { id: 'active', label: 'Active', count: groups.active.length },
            { id: 'requests', label: 'Requests', count: groups.requests.length },
            { id: 'history', label: 'History' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {TAB_IDS.map((id) => (
          <TabPanel key={id} tabsId="trips" id={id} active={tab === id}>
            {bookings.loading && !bookings.data ? (
              <LoadListSkeleton count={3} label="Loading your trips" />
            ) : bookings.error && !bookings.data ? (
              <ErrorState error={bookings.error} title="Couldn’t load your trips" onRetry={() => void bookings.reload()} />
            ) : (
              <TripList tab={id} trips={groups[id]} userId={user.id} now={now} onChanged={reloadAll} />
            )}
          </TabPanel>
        ))}
      </div>
    </div>
  );
}

function TripStats({ state }: { state: AsyncState<DriverStats> }) {
  if (state.error && !state.data) {
    return <ErrorState compact error={state.error} title="Couldn’t load your numbers" onRetry={() => void state.reload()} />;
  }
  const s = state.data;
  if (!s) {
    return (
      <StatGrid>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat" aria-hidden="true">
            <Skeleton width="60%" height={12} />
            <Skeleton width="40%" height={26} />
          </div>
        ))}
      </StatGrid>
    );
  }
  return (
    <StatGrid>
      <StatTile label="On your truck" value={number(s.activeLoads)} icon="truck" tone={s.activeLoads ? 'brand' : 'neutral'} />
      <StatTile label="Waiting on shippers" value={number(s.pendingRequests)} icon="clock" tone={s.pendingRequests ? 'warn' : 'neutral'} />
      <StatTile label="Delivered" value={number(s.completedLoads)} icon="check" tone="ok" />
      <StatTile label="Earned" value={money(s.earnedUsd)} icon="dollar" hint="From delivered loads" />
    </StatGrid>
  );
}

const EMPTY: Record<TabId, { icon: IconName; title: string; body: string }> = {
  active: {
    icon: 'truck',
    title: 'Nothing on your truck',
    body: 'Book a load and it shows up here with the next step: picked up, then delivered.',
  },
  requests: {
    icon: 'clock',
    title: 'No requests waiting',
    body: 'When you request a load, it waits here until the shipper accepts or declines.',
  },
  history: {
    icon: 'route',
    title: 'No past trips yet',
    body: 'Delivered loads, declined requests and anything you withdrew land here.',
  },
};

function TripList({
  tab,
  trips,
  userId,
  now,
  onChanged,
}: {
  tab: TabId;
  trips: Trip[];
  userId: string;
  now: Date;
  onChanged: () => void;
}) {
  if (trips.length === 0) {
    const empty = EMPTY[tab];
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        action={
          tab === 'history' ? undefined : (
            <ButtonLink to={paths.driverLoads} icon="boxes">
              Find loads
            </ButtonLink>
          )
        }
      >
        {empty.body}
      </EmptyState>
    );
  }
  return (
    <ul className="list-reset stack" aria-label={`${tab} trips`}>
      {trips.map((trip) => (
        <li key={trip.booking.id}>
          <TripCard trip={trip} tab={tab} userId={userId} now={now} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  );
}

function tripWhen(trip: Trip, tab: TabId, now: Date): { icon: IconName; text: string } {
  const { booking, load } = trip;
  if (tab === 'active') {
    if (load.status === 'in_transit') {
      const picked = load.pickedUpAt ? `Picked up ${timeAgo(load.pickedUpAt, now)}` : 'On your truck';
      return { icon: 'truck', text: load.deliveryBy ? `${picked} · deliver by ${pickupTime(load.deliveryBy, now)}` : picked };
    }
    return { icon: 'calendar', text: `Pickup ${timeWindow(load.pickupStart, load.pickupEnd, now)}` };
  }
  if (tab === 'requests') return { icon: 'clock', text: `Requested ${timeAgo(booking.createdAt, now)} · pickup ${pickupTime(load.pickupStart, now)}` };
  if (booking.status === 'accepted' && load.status === 'delivered') {
    return { icon: 'check', text: `Delivered ${shortDate(load.deliveredAt ?? booking.updatedAt, now)}` };
  }
  const verb = { declined: 'Declined', withdrawn: 'Withdrawn', cancelled: 'Cancelled', accepted: 'Updated', pending: 'Requested' }[booking.status];
  return { icon: 'clock', text: `${verb} ${shortDate(booking.updatedAt, now)}` };
}

function TripCard({ trip, tab, userId, now, onChanged }: { trip: Trip; tab: TabId; userId: string; now: Date; onChanged: () => void }) {
  const { booking, load } = trip;
  const delivered = booking.status === 'accepted' && load.status === 'delivered';
  const rate = booking.status === 'accepted' ? (load.bookedRateUsd ?? load.rateUsd) : (booking.offerRateUsd ?? load.rateUsd);
  const when = tripWhen(trip, tab, now);
  const href = paths.driverLoad(load.id);

  let status: ReactNode;
  if (tab === 'active' || delivered) status = <StatusBadge kind="load" status={load.status} />;
  else status = <StatusBadge kind="booking" status={booking.status} />;

  let actions: ReactNode = null;
  if (tab === 'active') {
    actions = (
      <>
        <ButtonLink to={paths.thread(load.id, userId)} variant="ghost" icon="message" aria-label="Message shipper" />
        <TripStatusButton load={load} onDone={onChanged} />
      </>
    );
  } else if (tab === 'requests') {
    actions = (
      <>
        <ButtonLink to={paths.thread(load.id, userId)} variant="ghost" icon="message" aria-label="Message shipper" />
        <WithdrawButton booking={booking} load={load} onDone={onChanged} />
      </>
    );
  }

  return (
    <article className={cx('card', 'load-card', 'load-card--linked', tab === 'history' && !delivered && 'load-card--ineligible')}>
      <div className="load-card__top">
        <div className="load-card__main">
          <h3 className="load-card__lane lane">
            <Link to={href} className="load-card__link">
              <span className="lane__city">{place(load.origin)}</span>
              <span className="lane__arrow" aria-label="to">
                <Icon name="arrowRight" size={16} />
              </span>
              <span className="lane__city">{place(load.destination)}</span>
            </Link>
          </h3>
          <p className="load-card__sub">
            <span className="num">{miles(load.miles)}</span>
            <span aria-hidden="true"> · </span>
            {load.commodity}
          </p>
        </div>
        <div className="load-card__money">
          <span className="load-card__rate num">{money(rate)}</span>
          <span className="load-card__rpm num">{ratePerMile(rate / Math.max(1, load.miles))}</span>
        </div>
      </div>

      <p className="drv-trip__when">
        <Icon name={when.icon} size={16} />
        <span>{when.text}</span>
      </p>

      <div className="load-card__specs">
        {status}
        {booking.offerRateUsd && booking.status !== 'accepted' ? <Tag tone="info">Your offer {money(booking.offerRateUsd)}</Tag> : null}
        {booking.status === 'accepted' && load.bookedRateUsd !== null && load.bookedRateUsd !== load.rateUsd ? (
          <Tag tone="ok">Counter accepted</Tag>
        ) : null}
        <EquipmentChips codes={load.equipmentTypes} max={2} />
      </div>

      <div className="load-card__footer">
        <span className="load-card__shipper">
          <Icon name="building" size={16} />
          {load.shipperCompany ?? load.shipperName}
        </span>
        {actions ? <div className="load-card__actions">{actions}</div> : null}
      </div>
    </article>
  );
}
