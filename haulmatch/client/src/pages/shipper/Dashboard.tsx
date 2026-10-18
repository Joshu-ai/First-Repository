import { useCallback, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { Booking, Load, LoadStatus, ServerEvent, ShipperStats } from '../../../../shared/types';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatGrid, StatTile } from '../../components/DataDisplay';
import { EmptyState, ErrorState, LoadListSkeleton, Skeleton } from '../../components/Feedback';
import type { IconName } from '../../components/Icon';
import { LoadCard } from '../../components/LoadCard';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs, type TabItem } from '../../components/Tabs';
import { api } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { lane, plural } from '../../lib/format';
import { useApi, useNow } from '../../lib/hooks';
import { paths } from '../../lib/routes';
import { RequestRow } from './components/Requests';
import { useLiveReload } from './components/useLiveReload';
import { useRequestDecisions, type RequestDecisions } from './components/useRequestDecisions';
import './shipper.css';

type Tab = 'active' | LoadStatus;

const TABS: Tab[] = ['active', 'open', 'booked', 'in_transit', 'delivered', 'cancelled'];
const TAB_PARAM = 'tab';

const TAB_LABELS: Record<Tab, string> = {
  active: 'Active',
  open: 'Open',
  booked: 'Booked',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const EMPTY_COPY: Record<Tab, { icon: IconName; title: string; body: string }> = {
  active: {
    icon: 'boxes',
    title: 'Nothing on the board',
    body: 'Post a load and drivers whose rigs fit it are matched right away.',
  },
  open: {
    icon: 'boxes',
    title: 'No open loads',
    body: 'Everything you posted is covered. Post another when you have freight.',
  },
  booked: {
    icon: 'check',
    title: 'Nothing booked yet',
    body: 'When you accept a request or a driver instant-books, the load shows up here.',
  },
  in_transit: {
    icon: 'truck',
    title: 'Nothing on the road',
    body: 'Loads move here once the driver marks them picked up.',
  },
  delivered: {
    icon: 'route',
    title: 'No deliveries yet',
    body: 'Finished loads land here, so you can repost a lane in one tap.',
  },
  cancelled: {
    icon: 'x',
    title: 'No cancelled loads',
    body: 'Loads you cancel show up here.',
  },
};

const PENDING_PREVIEW = 5;
const LOAD_PAGE = 15;

/** Loads stay live as long as these events keep arriving. */
const SHIPPER_NOTIFICATIONS = new Set(['booking_request', 'booking_withdrawn', 'load_booked', 'load_status', 'load_cancelled']);

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

function tabCount(tab: Tab, stats: ShipperStats | undefined): number | undefined {
  if (!stats) return undefined;
  switch (tab) {
    case 'active':
      return stats.open + stats.booked + stats.inTransit;
    case 'open':
      return stats.open;
    case 'booked':
      return stats.booked;
    case 'in_transit':
      return stats.inTransit;
    case 'delivered':
      return stats.delivered;
    case 'cancelled':
      return stats.cancelled;
  }
}

function isLiveEvent(event: ServerEvent): boolean {
  if (event.type === 'notification') return SHIPPER_NOTIFICATIONS.has(event.notification.type);
  return event.type === 'booking_updated' || event.type === 'load_updated' || event.type === 'hello';
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function StatsSkeleton() {
  return (
    <StatGrid>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={cx('stat', i === 0 && 'sh-stat-cta')} aria-hidden="true">
          <Skeleton width="55%" height={12} />
          <Skeleton width={56} height={30} />
          <Skeleton width="70%" height={12} />
        </div>
      ))}
      <span className="visually-hidden" role="status">
        Loading your numbers
      </span>
    </StatGrid>
  );
}

function StatsTiles({ stats, requestsHref, tabHref }: { stats: ShipperStats; requestsHref: string; tabHref: (tab: Tab) => string }) {
  const pending = stats.pendingRequests;
  return (
    <StatGrid>
      <StatTile
        className="sh-stat-cta"
        label="Needs review"
        icon="users"
        tone={pending > 0 ? 'warn' : 'neutral'}
        value={pending}
        hint={pending > 0 ? `${plural(pending, 'driver request')} waiting on you` : 'You’re all caught up'}
        to={pending > 0 ? requestsHref : undefined}
      />
      <StatTile label="Open" icon="boxes" tone="brand" value={stats.open} hint="On the board" to={tabHref('open')} />
      <StatTile label="Booked" icon="check" tone="info" value={stats.booked} hint="Driver assigned" to={tabHref('booked')} />
      <StatTile label="In transit" icon="truck" value={stats.inTransit} hint="On the road" to={tabHref('in_transit')} />
      <StatTile label="Delivered" icon="route" tone="ok" value={stats.delivered} hint="All time" to={tabHref('delivered')} />
    </StatGrid>
  );
}

// ---------------------------------------------------------------------------
// Requests panel
// ---------------------------------------------------------------------------

type PendingBooking = Booking & { load: Load };

interface RequestsPanelProps {
  requests: PendingBooking[] | undefined;
  error: unknown;
  onRetry: () => void;
  decisions: RequestDecisions;
  now: Date;
}

function RequestsPanel({ requests, error, onRetry, decisions, now }: RequestsPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const empty = requests !== undefined && requests.length === 0 && !error;
  const shown = requests && !showAll ? requests.slice(0, PENDING_PREVIEW) : requests;

  let body;
  if (requests === undefined && error) {
    body = <ErrorState compact error={error} title="Couldn’t load requests" onRetry={onRetry} />;
  } else if (requests === undefined) {
    body = (
      <div className="stack" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="row row-nowrap" aria-hidden="true">
            <Skeleton width={40} height={40} radius="50%" />
            <div className="grow">
              <Skeleton lines={2} />
            </div>
          </div>
        ))}
        <span className="visually-hidden" role="status">
          Loading requests
        </span>
      </div>
    );
  } else if (requests.length === 0) {
    body = (
      <p className="muted text-sm">
        No requests waiting. When a driver asks to haul one of your review-mode loads, it shows up here.
      </p>
    );
  } else {
    body = (
      <>
        <ul className="divided sh-requests">
          {shown!.map((booking) => (
            <RequestRow
              key={booking.id}
              booking={booking}
              busy={decisions.busyId === booking.id}
              locked={decisions.busyId !== null && decisions.busyId !== booking.id}
              onAccept={() => decisions.ask('accept', booking, booking.load)}
              onDecline={() => decisions.ask('decline', booking, booking.load)}
              now={now}
            />
          ))}
        </ul>
        {requests.length > PENDING_PREVIEW ? (
          <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Show fewer' : `Show all ${requests.length} requests`}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <aside className={cx('sh-dash__aside', empty && 'sh-dash__aside--empty')} id="requests" tabIndex={-1}>
      <Card
        as="section"
        title="Requests waiting"
        subtitle="Drivers asking to haul your loads"
        actions={
          requests && requests.length > 0 ? (
            <Badge tone="warn" solid>
              {requests.length}
            </Badge>
          ) : null
        }
      >
        {body}
      </Card>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Load list
// ---------------------------------------------------------------------------

function LoadRowActions({ load }: { load: Load }) {
  const name = lane(load.origin, load.destination);
  return (
    <>
      {load.pendingRequestCount > 0 && load.status === 'open' ? (
        <ButtonLink size="sm" icon="users" to={`${paths.shipperLoad(load.id)}#requests`} aria-label={`Review requests on ${name}`}>
          Review
        </ButtonLink>
      ) : (
        <ButtonLink size="sm" variant="secondary" to={paths.shipperLoad(load.id)} aria-label={`View ${name}`}>
          View
        </ButtonLink>
      )}
      {load.status === 'open' ? (
        <ButtonLink size="sm" variant="ghost" icon="edit" to={paths.shipperEditLoad(load.id)} aria-label={`Edit ${name}`}>
          Edit
        </ButtonLink>
      ) : null}
      <ButtonLink size="sm" variant="ghost" icon="copy" to={paths.shipperRepost(load.id)} aria-label={`Repost ${name}`}>
        Repost
      </ButtonLink>
    </>
  );
}

interface LoadListProps {
  tab: Tab;
  loads: Load[] | undefined;
  error: unknown;
  onRetry: () => void;
  now: Date;
}

function LoadList({ tab, loads, error, onRetry, now }: LoadListProps) {
  const [limit, setLimit] = useState(LOAD_PAGE);
  if (loads === undefined && error) return <ErrorState error={error} title="Couldn’t load your loads" onRetry={onRetry} />;
  if (loads === undefined) return <LoadListSkeleton count={3} label="Loading your loads" />;
  if (loads.length === 0) {
    const copy = EMPTY_COPY[tab];
    return (
      <EmptyState
        icon={copy.icon}
        title={copy.title}
        action={
          tab === 'active' || tab === 'open' ? (
            <ButtonLink to={paths.shipperNewLoad} icon="plus">
              Post a load
            </ButtonLink>
          ) : null
        }
      >
        <p>{copy.body}</p>
      </EmptyState>
    );
  }
  const remaining = loads.length - limit;
  return (
    <div className="stack">
      <ul className="sh-load-list" aria-label={`${TAB_LABELS[tab]} loads`}>
        {loads.slice(0, limit).map((load) => (
          <li key={load.id}>
            <LoadCard
              load={load}
              variant="compact"
              href={paths.shipperLoad(load.id)}
              now={now}
              actions={<LoadRowActions load={load} />}
            />
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <div className="stack-xs">
          <Button variant="secondary" block onClick={() => setLimit((n) => n + LOAD_PAGE)}>
            Show {Math.min(remaining, LOAD_PAGE)} more
          </Button>
          <p className="muted text-sm text-center">
            Showing {limit} of {loads.length}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ShipperDashboardPage() {
  const user = useSignedInUser();
  const now = useNow();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get(TAB_PARAM);
  const tab: Tab = isTab(rawTab) ? rawTab : 'active';

  const stats = useApi((signal) => api.shipper.stats({ signal }), []);
  const loads = useApi(async (signal) => ({ tab, loads: await api.shipper.loads(tab, { signal }) }), [tab]);
  const requests = useApi(
    async (signal) => (await api.bookings.list('pending', { signal })).filter((b): b is PendingBooking => b.load !== undefined),
    [],
  );

  const { reload: reloadStats } = stats;
  const { reload: reloadLoads } = loads;
  const { reload: reloadRequests } = requests;
  const reloadAll = useCallback(() => {
    void reloadStats();
    void reloadLoads();
    void reloadRequests();
  }, [reloadStats, reloadLoads, reloadRequests]);

  useLiveReload(isLiveEvent, reloadAll);
  const decisions = useRequestDecisions(reloadAll);

  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'active') nextParams.delete(TAB_PARAM);
    else nextParams.set(TAB_PARAM, next);
    setParams(nextParams, { replace: true, preventScrollReset: true });
  };

  const tabHref = (next: Tab) => (next === 'active' ? location.pathname : `?${TAB_PARAM}=${next}`);
  const tabItems: TabItem<Tab>[] = TABS.map((id) => ({ id, label: TAB_LABELS[id], count: tabCount(id, stats.data) }));
  // Rows for another tab may still be on screen while the new tab loads; show the skeleton instead.
  const currentLoads = loads.data?.tab === tab ? loads.data.loads : undefined;

  return (
    <div className="stack-lg sh-page">
      <PageHeader
        title="Dashboard"
        eyebrow={user.company ?? user.name}
        subtitle="Your loads, and the drivers asking to haul them."
        actions={
          <ButtonLink to={paths.shipperNewLoad} icon="plus" size="lg">
            Post a load
          </ButtonLink>
        }
      />

      {stats.data ? (
        <StatsTiles stats={stats.data} requestsHref={`${location.search}#requests`} tabHref={tabHref} />
      ) : stats.error ? (
        <ErrorState compact error={stats.error} title="Couldn’t load your numbers" onRetry={() => void stats.reload()} />
      ) : (
        <StatsSkeleton />
      )}

      <div className="sh-dash">
        <RequestsPanel
          requests={requests.data}
          error={requests.error}
          onRetry={() => void requests.reload()}
          decisions={decisions}
          now={now}
        />

        <section className="stack-sm" aria-labelledby="shipper-loads-title">
          <h2 id="shipper-loads-title" className="section-title">
            Your loads
          </h2>
          <Tabs id="shipper-loads" label="Filter loads by status" tabs={tabItems} value={tab} onChange={setTab} />
          {TABS.map((id) => (
            <TabPanel key={id} tabsId="shipper-loads" id={id} active={id === tab}>
              <LoadList
                tab={id}
                loads={currentLoads}
                error={loads.error}
                onRetry={() => void loads.reload()}
                now={now}
              />
            </TabPanel>
          ))}
        </section>
      </div>

      {decisions.dialog}
    </div>
  );
}
