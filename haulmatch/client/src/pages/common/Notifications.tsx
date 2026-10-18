import { useState } from 'react';
import { Link } from 'react-router';
import type { AppNotification, NotificationType } from '../../../../shared/types';
import { Button, ButtonLink } from '../../components/Button';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { dayLabel, plural, timeAgo } from '../../lib/format';
import { useAction, useApi, useNow } from '../../lib/hooks';
import { useRealtime, useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import { useOnReconnect } from './components/live';
import './components/common.css';

/** The most the API returns in one page. */
const LIMIT = 100;

type Tab = 'all' | 'unread';
type IconTone = 'brand' | 'ok' | 'bad' | 'warn' | 'info' | 'neutral';

const KINDS: Record<NotificationType, { icon: IconName; tone: IconTone; label: string }> = {
  load_match: { icon: 'bolt', tone: 'brand', label: 'Load match' },
  booking_request: { icon: 'users', tone: 'warn', label: 'Booking request' },
  booking_accepted: { icon: 'check', tone: 'ok', label: 'Request accepted' },
  booking_declined: { icon: 'x', tone: 'bad', label: 'Request declined' },
  booking_withdrawn: { icon: 'arrowLeft', tone: 'neutral', label: 'Request withdrawn' },
  load_booked: { icon: 'truck', tone: 'ok', label: 'Load booked' },
  load_status: { icon: 'route', tone: 'info', label: 'Load update' },
  load_cancelled: { icon: 'warning', tone: 'bad', label: 'Load cancelled' },
  message: { icon: 'message', tone: 'info', label: 'Message' },
};

export default function NotificationsPage() {
  const user = useSignedInUser();
  const toast = useToast();
  const now = useNow();
  const { unreadCount, setUnreadCount } = useRealtime();
  const [tab, setTab] = useState<Tab>('all');
  const list = useApi(async (signal) => {
    const res = await api.notifications.list({ limit: LIMIT }, { signal });
    // A fresh server count is the best there is; correct the bell with it.
    setUnreadCount(res.unreadCount);
    return res;
  }, []);
  const markAll = useAction(() => api.notifications.markRead());

  useServerEvent((event) => {
    if (event.type !== 'notification') return;
    const incoming = event.notification;
    list.setData((prev) => {
      if (!prev || prev.notifications.some((n) => n.id === incoming.id)) return prev;
      return { notifications: [incoming, ...prev.notifications], unreadCount: prev.unreadCount + (incoming.readAt ? 0 : 1) };
    });
  });

  useOnReconnect(() => void list.reload());

  const markLocal = (ids: string[] | null, readAt: string) =>
    list.setData((prev) =>
      prev
        ? {
            notifications: prev.notifications.map((n) => (!n.readAt && (ids === null || ids.includes(n.id)) ? { ...n, readAt } : n)),
            unreadCount: ids === null ? 0 : Math.max(0, prev.unreadCount - ids.length),
          }
        : prev,
    );

  const open = (notification: AppNotification) => {
    if (notification.readAt) return;
    markLocal([notification.id], new Date().toISOString());
    setUnreadCount(Math.max(0, unreadCount - 1));
    api.notifications
      .markRead([notification.id])
      .then((res) => setUnreadCount(res.unreadCount))
      .catch(() => {
        // The person is already on their way to the link; the bell corrects on the next load.
      });
  };

  const markAllRead = async () => {
    const res = await markAll.run();
    if (!res) return;
    markLocal(null, new Date().toISOString());
    setUnreadCount(res.unreadCount);
    toast.success('All caught up', 'Every notification is marked read.');
  };

  const items = list.data?.notifications ?? [];
  const localUnread = items.filter((n) => !n.readAt).length;
  const unreadTotal = list.data ? Math.max(unreadCount, localUnread) : unreadCount;
  const shown = tab === 'unread' ? items.filter((n) => !n.readAt) : items;

  return (
    <div className="stack-lg">
      <PageHeader
        title="Notifications"
        subtitle={
          <span aria-live="polite">{unreadTotal > 0 ? plural(unreadTotal, 'unread notification') : 'You’re all caught up.'}</span>
        }
        actions={
          <Button
            variant="secondary"
            icon="check"
            onClick={() => void markAllRead()}
            loading={markAll.pending}
            disabled={unreadTotal === 0 || !list.data}
          >
            Mark all read
          </Button>
        }
      />

      {markAll.error ? (
        <InlineAlert tone="bad" title="Couldn’t mark everything read">
          {errorMessage(markAll.error)}
        </InlineAlert>
      ) : null}

      {list.loading && !list.data ? (
        <NotificationsSkeleton />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} title="Couldn’t load notifications" onRetry={() => void list.reload()} />
      ) : items.length === 0 ? (
        <NoNotifications role={user.role} />
      ) : (
        <div className="stack">
          <Tabs
            id="notifications"
            label="Show"
            tabs={[
              { id: 'all', label: 'All' },
              { id: 'unread', label: 'Unread', count: localUnread },
            ]}
            value={tab}
            onChange={setTab}
          />
          <TabPanel tabsId="notifications" id={tab} active>
            {shown.length === 0 ? (
              <EmptyState icon="check" title="You’re all caught up">
                Nothing unread. New load matches, requests and messages land here as they happen.
              </EmptyState>
            ) : (
              <NotificationGroups notifications={shown} now={now} onOpen={open} />
            )}
            {list.data && list.data.notifications.length >= LIMIT ? (
              <p className="muted text-sm text-center">Showing your latest {LIMIT} notifications.</p>
            ) : null}
          </TabPanel>
        </div>
      )}
    </div>
  );
}

function NotificationGroups({
  notifications,
  now,
  onOpen,
}: {
  notifications: AppNotification[];
  now: Date;
  onOpen: (notification: AppNotification) => void;
}) {
  return (
    <div className="stack-lg">
      {groupByDay(notifications, now).map((group) => (
        <section key={group.label} className="cm-notes-day" aria-labelledby={`notes-${group.key}`}>
          <h2 className="cm-notes-day__title" id={`notes-${group.key}`}>
            {group.label}
          </h2>
          <div className="card card--flush">
            <ul className="divided">
              {group.items.map((n) => (
                <li key={n.id}>
                  <NotificationRow notification={n} now={now} onOpen={() => onOpen(n)} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

function NotificationRow({ notification, now, onOpen }: { notification: AppNotification; now: Date; onOpen: () => void }) {
  const kind = KINDS[notification.type] ?? { icon: 'bell' as IconName, tone: 'neutral' as IconTone, label: 'Update' };
  const unread = !notification.readAt;
  const content = (
    <>
      <span className={cx('cm-note__icon', `cm-note__icon--${kind.tone}`)} aria-hidden="true">
        <Icon name={kind.icon} size={20} />
      </span>
      <span className="cm-note__text">
        <span className="cm-note__title">{notification.title}</span>
        {notification.body ? <span className="cm-note__body">{notification.body}</span> : null}
        <span className="cm-note__meta">
          {kind.label} · <time dateTime={notification.createdAt}>{timeAgo(notification.createdAt, now)}</time>
        </span>
      </span>
      <span className="cm-note__aside">
        {unread ? <span className="cm-note__new">New</span> : null}
        {notification.link ? <Icon name="chevronRight" size={20} /> : null}
      </span>
    </>
  );
  const className = cx('cm-note', unread && 'is-unread');

  if (notification.link) {
    return (
      <Link to={notification.link} className={className} onClick={onOpen}>
        {content}
      </Link>
    );
  }
  if (unread) {
    return (
      <button type="button" className={className} onClick={onOpen}>
        {content}
        <span className="visually-hidden">Mark as read</span>
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

interface NotificationGroup {
  key: string;
  label: string;
  items: AppNotification[];
}

/** Newest-first notifications split by local calendar day ("Today", "Yesterday", "Wed, Oct 14"). */
function groupByDay(notifications: AppNotification[], now: Date): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const n of notifications) {
    const label = dayLabel(n.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ key: n.id, label, items: [n] });
  }
  return groups;
}

function NoNotifications({ role }: { role: 'driver' | 'shipper' }) {
  return role === 'driver' ? (
    <EmptyState
      icon="bell"
      title="No notifications yet"
      action={
        <ButtonLink to={paths.driverAlerts} icon="siren">
          Set up a load alert
        </ButtonLink>
      }
    >
      We’ll ping you here when a load that fits your rig posts, when a shipper answers your request, and when someone
      messages you.
    </EmptyState>
  ) : (
    <EmptyState
      icon="bell"
      title="No notifications yet"
      action={
        <ButtonLink to={paths.shipperNewLoad} icon="plusSquare">
          Post a load
        </ButtonLink>
      }
    >
      Booking requests, booked loads, pickups, deliveries and driver messages show up here as they happen.
    </EmptyState>
  );
}

function NotificationsSkeleton() {
  return (
    <div className="card card--flush" aria-busy="true" aria-label="Loading notifications" role="status">
      <ul className="divided">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="cm-note cm-note--skeleton" aria-hidden="true">
            <Skeleton width={40} height={40} radius="50%" />
            <span className="cm-note__text">
              <Skeleton width="60%" height={16} />
              <Skeleton width="85%" height={13} />
              <Skeleton width="30%" height={12} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
