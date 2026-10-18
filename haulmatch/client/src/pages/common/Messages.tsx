import { Navigate, useParams } from 'react-router';
import type { Message } from '../../../../shared/types';
import { ButtonLink } from '../../components/Button';
import { EmptyState, ErrorState } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { api } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { useApi, useMediaQuery, useNow } from '../../lib/hooks';
import { useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import { Conversation } from './components/Conversation';
import { useOnReconnect } from './components/live';
import { ThreadList, ThreadListSkeleton } from './components/ThreadList';
import { applyMessage, clearUnread, findThread, keyOf, threadKey } from './components/threads';
import './components/common.css';

/** From here up the list and the open conversation sit side by side. */
const TWO_PANE_QUERY = '(min-width: 900px)';

export default function MessagesPage() {
  const viewer = useSignedInUser();
  const { loadId, driverId } = useParams();
  const twoPane = useMediaQuery(TWO_PANE_QUERY);
  const now = useNow();
  const threads = useApi((signal) => api.messages.threads({ signal }), []);
  const openKey = loadId && driverId ? threadKey(loadId, driverId) : null;
  const openThread = findThread(threads.data, openKey);
  const listSettled = threads.data !== undefined || Boolean(threads.error);

  useServerEvent((event) => {
    if (event.type !== 'message') return;
    const { message } = event;
    // A conversation someone else just started: reload to get its load and counterpart.
    if (!findThread(threads.data, keyOf(message))) {
      void threads.reload();
      return;
    }
    threads.setData((prev) => (prev ? applyMessage(prev, message, viewer.id, openKey) : prev));
  });

  useOnReconnect(() => void threads.reload());

  const onSent = (message: Message) => {
    if (findThread(threads.data, keyOf(message))) {
      threads.setData((prev) => (prev ? applyMessage(prev, message, viewer.id, openKey) : prev));
    } else {
      void threads.reload();
    }
  };

  const onRead = () => {
    if (openKey) threads.setData((prev) => (prev ? clearUnread(prev, openKey) : prev));
  };

  // Drivers only have their own side of a conversation; keep their URLs canonical.
  if (viewer.role === 'driver' && loadId && driverId && driverId !== viewer.id) {
    return <Navigate to={paths.thread(loadId, viewer.id)} replace />;
  }

  const list = threads.data ?? [];
  const unread = list.reduce((sum, t) => sum + (threadKey(t.loadId, t.driverId) === openKey ? 0 : t.unreadCount), 0);
  const noThreadsAtAll = threads.data !== undefined && list.length === 0 && !openKey;
  const showList = twoPane || !openKey;
  const showConversation = twoPane ? !noThreadsAtAll : Boolean(openKey);
  const fixedHeight = showConversation;
  const documentTitle = openThread ? `${openThread.counterpart.name} · Messages` : 'Messages';

  const subtitle =
    unread > 0
      ? plural(unread, 'unread message')
      : viewer.role === 'driver'
        ? 'Talk to shippers about pickup times, freight and rates.'
        : 'Talk to drivers about your loads.';

  return (
    <div className={cx('cm-messages', fixedHeight && 'cm-messages--fixed', openKey && 'cm-messages--open')}>
      {/* On phones the open conversation gets the whole screen; the h1 stays for screen readers. */}
      <div className={cx('cm-messages__header', !twoPane && openKey && 'visually-hidden')}>
        <PageHeader title="Messages" documentTitle={documentTitle} subtitle={<span aria-live="polite">{subtitle}</span>} />
      </div>

      {noThreadsAtAll ? (
        <NoConversations role={viewer.role} />
      ) : (
        <div className={cx('cm-panes', twoPane && 'cm-panes--two')}>
          {showList ? (
            <section className="card card--flush cm-pane cm-pane--list" aria-label="Conversations">
              {threads.data === undefined ? (
                threads.error ? (
                  <div className="cm-pane__pad">
                    <ErrorState compact error={threads.error} title="Couldn’t load your messages" onRetry={() => void threads.reload()} />
                  </div>
                ) : (
                  <ThreadListSkeleton />
                )
              ) : list.length === 0 ? (
                <p className="cm-pane__note muted">No other conversations yet.</p>
              ) : (
                <ThreadList threads={list} viewerId={viewer.id} activeKey={openKey} now={now} />
              )}
            </section>
          ) : null}

          {showConversation ? (
            <section className="card card--flush cm-pane cm-pane--convo" aria-label="Conversation">
              {loadId && driverId ? (
                <Conversation
                  key={openKey}
                  viewer={viewer}
                  loadId={loadId}
                  driverId={driverId}
                  thread={openThread}
                  listSettled={listSettled}
                  showBack={!twoPane}
                  onSent={onSent}
                  onRead={onRead}
                />
              ) : (
                <PickAConversation role={viewer.role} />
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoConversations({ role }: { role: 'driver' | 'shipper' }) {
  return role === 'driver' ? (
    <EmptyState
      icon="message"
      title="No messages yet"
      action={
        <ButtonLink to={paths.driverLoads} icon="boxes">
          Find loads
        </ButtonLink>
      }
    >
      Open any load and tap “Message shipper” to ask about pickup times, the freight or the rate. Replies show up here.
    </EmptyState>
  ) : (
    <EmptyState
      icon="message"
      title="No messages yet"
      action={
        <ButtonLink to={paths.shipperHome} icon="grid">
          Go to your dashboard
        </ButtonLink>
      }
    >
      Message a driver from one of your loads, from a booking request or a recommended driver. Their replies show up here.
    </EmptyState>
  );
}

function PickAConversation({ role }: { role: 'driver' | 'shipper' }) {
  return (
    <div className="cm-pick">
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name="message" size={28} />
      </span>
      <h2 className="cm-pick__title">Pick a conversation</h2>
      <p className="muted">
        {role === 'driver'
          ? 'Choose a shipper on the left to read and reply.'
          : 'Choose a driver on the left to read and reply.'}
      </p>
    </div>
  );
}
