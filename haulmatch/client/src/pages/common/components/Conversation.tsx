import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { LoadStatus, Message, Role, Thread, User } from '../../../../../shared/types';
import { Chip, StatusBadge } from '../../../components/Badge';
import { Button, ButtonLink } from '../../../components/Button';
import { Avatar } from '../../../components/DataDisplay';
import { ErrorState, Skeleton } from '../../../components/Feedback';
import { Icon } from '../../../components/Icon';
import { api, errorMessage, isApiError } from '../../../lib/api';
import { cx } from '../../../lib/cx';
import { clockTime, money, pickupTime, place, plural } from '../../../lib/format';
import { useAction, useApi, useNow } from '../../../lib/hooks';
import { useRealtime, useServerEvent } from '../../../lib/realtime';
import { loadPathFor, paths } from '../../../lib/routes';
import { Composer } from './Composer';
import { isPageVisible, markThreadNotificationsRead, useOnReconnect } from './live';
import {
  appendMessage,
  counterpartRoleLabel,
  groupByDay,
  prependOlder,
  threadKey,
  withNewestPage,
  type ThreadContext,
} from './threads';

/** Unsent text per conversation, kept while the person hops between threads and pages. */
const drafts = new Map<string, string>();

/** Within this distance of the bottom the log counts as "at the latest message" and follows new ones. */
const STICK_PX = 96;

/** Messages per page; a page shorter than this reaches the start of the conversation. */
export const MESSAGE_PAGE = 100;

/** Tap-to-fill openers for an empty conversation (they fill the box; nothing sends until the person taps Send). */
const STARTERS: Record<Role, string[]> = {
  driver: ['Is this load still available?', 'What are the pickup hours?', 'Any flexibility on the rate?'],
  shipper: ['Are you available for this load?', 'What’s your ETA to pickup?', 'Can you send your MC number?'],
};

export interface ConversationProps {
  viewer: User;
  loadId: string;
  driverId: string;
  /** The thread from the list when it is there; it carries the header details. */
  thread: Thread | undefined;
  /** The list has loaded (or failed), so a missing thread means a brand-new conversation. */
  listSettled: boolean;
  /** Phones: show a back button to the conversation list. */
  showBack: boolean;
  onSent: (message: Message) => void;
  /** The person read this conversation (it is being marked read on the server); clear its unread count. */
  onRead: () => void;
}

export function Conversation({ viewer, loadId, driverId, thread, listSettled, showBack, onSent, onRead }: ConversationProps) {
  const key = threadKey(loadId, driverId);
  const threadPath = paths.thread(loadId, driverId);
  // Drivers always talk about their own thread; only shippers name the driver.
  const queryDriverId = viewer.role === 'shipper' ? driverId : undefined;
  const now = useNow();
  const { unreadCount, setUnreadCount } = useRealtime();

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const unreadRef = useRef(unreadCount);
  unreadRef.current = unreadCount;
  // Live messages that land while the first fetch is in flight.
  const early = useRef<Message[]>([]);
  /** What is on screen, so a re-read (after a dropped connection) keeps the earlier pages loaded. */
  const shownRef = useRef<Message[]>([]);
  // Only the newest page loads at first; earlier ones load on request.
  const [hasOlder, setHasOlder] = useState(false);
  const olderLoaded = useRef(false);

  const messages = useApi(
    async (signal) => {
      const page = await api.messages.list(loadId, queryDriverId, { limit: MESSAGE_PAGE }, { signal });
      if (!olderLoaded.current) setHasOlder(page.length >= MESSAGE_PAGE);
      return early.current.reduce(appendMessage, withNewestPage(shownRef.current, page));
    },
    [loadId, queryDriverId],
  );
  shownRef.current = messages.data ?? [];
  const loaded = messages.data !== undefined;

  const fallback = useApi((signal) => fetchContext(viewer.role, loadId, driverId, signal), [loadId, driverId, viewer.role], {
    enabled: listSettled && !thread,
  });
  const context: ThreadContext | undefined = thread ? { load: thread.load, counterpart: thread.counterpart } : fallback.data;
  const [liveStatus, setLiveStatus] = useState<LoadStatus | null>(null);

  const syncBell = useCallback(() => {
    if (unreadRef.current === 0) return;
    markThreadNotificationsRead(threadPath)
      .then((count) => {
        if (count !== null) setUnreadCount(count);
      })
      .catch(() => {
        // Only the bell count is affected; it corrects itself on the next event or reload.
      });
  }, [threadPath, setUnreadCount]);

  // Unread messages that arrived while the tab was in the background.
  const pendingRead = useRef(false);
  const markSeen = useCallback(() => {
    pendingRead.current = false;
    onReadRef.current();
    api.messages
      .markRead(loadId, queryDriverId)
      // Again once the server agrees, in case the list was re-read in between.
      .then(() => onReadRef.current())
      .catch(() => {
        // Harmless: the next time the thread opens it is marked read again.
      });
  }, [loadId, queryDriverId]);

  // Reading the messages marks nothing on the server (a GET has no side effects), so opening the
  // conversation tells it, then the list and the bell. A tab in the background waits until it is seen.
  useEffect(() => {
    if (!loaded) return;
    if (!isPageVisible()) {
      pendingRead.current = shownRef.current.length > 0;
      return;
    }
    if (shownRef.current.length > 0) markSeen();
    syncBell();
    // Once per opening; later messages are marked as they arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    const onVisibility = () => {
      if (!isPageVisible() || !pendingRead.current) return;
      markSeen();
      syncBell();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [markSeen, syncBell]);

  // ---- Scrolling: follow new messages while the person is at the bottom ----
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const forceScroll = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const count = messages.data?.length ?? 0;

  /** Distance from the bottom to keep while an earlier page is added above, so the view stays put. */
  const keepFromBottom = useRef<number | null>(null);

  const scrollToBottom = (smooth = false) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
      return;
    }
    if (!forceScroll.current && !atBottom.current) return;
    forceScroll.current = false;
    el.scrollTop = el.scrollHeight;
  }, [count, loaded]);

  // ---- Earlier pages ----
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const loadOlder = async () => {
    const oldest = messages.data?.[0];
    if (!oldest || olderLoading) return;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const page = await api.messages.list(loadId, queryDriverId, { before: oldest.id, limit: MESSAGE_PAGE });
      olderLoaded.current = true;
      const el = logRef.current;
      if (el && page.length) keepFromBottom.current = el.scrollHeight - el.scrollTop;
      messages.setData((prev) => (prev ? prependOlder(prev, page) : prev));
      setHasOlder(page.length >= MESSAGE_PAGE);
    } catch (err) {
      setOlderError(err);
    } finally {
      setOlderLoading(false);
    }
  };

  // Stay pinned to the latest message when the box grows or the phone keyboard opens.
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (atBottom.current && unseen > 0) setUnseen(0);
  };

  // ---- Live events ----
  useServerEvent((event) => {
    if (event.type === 'message') {
      const message = event.message;
      if (threadKey(message.loadId, message.driverId) !== key) return;
      if (messages.data === undefined) early.current = appendMessage(early.current, message);
      messages.setData((prev) => (prev ? appendMessage(prev, message) : prev));
      if (message.senderId === viewer.id) return;
      if (isPageVisible()) markSeen();
      else pendingRead.current = true;
      if (!atBottom.current) setUnseen((n) => n + 1);
    } else if (event.type === 'notification') {
      const { notification } = event;
      if (notification.type !== 'message' || notification.link !== threadPath || !isPageVisible()) return;
      api.notifications
        .markRead([notification.id])
        .then((res) => setUnreadCount(res.unreadCount))
        .catch(() => {
          // Bell only; see syncBell.
        });
    } else if (event.type === 'load_updated' && event.loadId === loadId) {
      setLiveStatus(event.status);
    }
  });

  useOnReconnect(() => void messages.reload());

  // ---- Sending ----
  const [draft, setDraftState] = useState(() => drafts.get(key) ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const send = useAction((body: string) => api.messages.send(loadId, { body, driverId: queryDriverId }));

  const setDraft = (value: string) => {
    setDraftState(value);
    if (value) drafts.set(key, value);
    else drafts.delete(key);
    if (send.error) send.reset();
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || send.pending) return;
    const message = await send.run(body);
    // On failure the draft stays in the box and the error shows under it.
    if (!message) return;
    setDraft('');
    forceScroll.current = true;
    messages.setData((prev) => appendMessage(prev ?? [], message));
    onSent(message);
    textareaRef.current?.focus();
  };

  const sendError = send.error
    ? ((isApiError(send.error) ? send.error.fieldErrors().body : undefined) ?? errorMessage(send.error))
    : null;

  const fillStarter = (text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  };

  const recipient = context?.counterpart.name ?? (viewer.role === 'driver' ? 'the shipper' : 'the driver');
  const status = liveStatus ?? context?.load.status;

  return (
    <div className="cm-convo">
      <ConversationHeader
        context={context}
        status={status}
        loading={!context && !fallback.error}
        error={context ? null : fallback.error}
        onRetry={() => void fallback.reload()}
        showBack={showBack}
        loadHref={loadPathFor(viewer.role, loadId)}
      />

      <div className="cm-convo__body">
        {!loaded ? (
          messages.error ? (
            <div className="cm-convo__state">
              <ErrorState
                error={messages.error}
                title={isApiError(messages.error) && messages.error.status === 404 ? 'Conversation not found' : 'Couldn’t load messages'}
                onRetry={() => void messages.reload()}
              />
            </div>
          ) : (
            <MessagesSkeleton />
          )
        ) : (
          <div
            ref={logRef}
            className="cm-log"
            role="log"
            aria-label={`Messages with ${recipient}`}
            tabIndex={0}
            onScroll={onScroll}
          >
            {hasOlder ? (
              <div className="cm-older">
                {olderError ? (
                  <ErrorState compact error={olderError} title="Couldn’t load earlier messages" onRetry={() => void loadOlder()} />
                ) : (
                  <Button variant="ghost" size="sm" icon="chevronUp" loading={olderLoading} onClick={() => void loadOlder()}>
                    Load earlier messages
                  </Button>
                )}
              </div>
            ) : olderLoaded.current ? (
              <p className="cm-older muted text-xs">Start of the conversation</p>
            ) : null}
            {count === 0 ? (
              <EmptyConversation role={viewer.role} recipient={recipient} onPick={fillStarter} />
            ) : (
              <MessageLog messages={messages.data ?? []} viewerId={viewer.id} now={now} />
            )}
          </div>
        )}
        {unseen > 0 ? (
          <button
            type="button"
            className="cm-jump"
            onClick={() => {
              scrollToBottom(true);
              setUnseen(0);
            }}
          >
            <Icon name="chevronDown" size={18} />
            {plural(unseen, 'new message')}
          </button>
        ) : null}
      </div>

      {loaded ? (
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void submit()}
          sending={send.pending}
          error={sendError}
          recipient={recipient}
          textareaRef={textareaRef}
        />
      ) : null}
    </div>
  );
}

async function fetchContext(role: Role, loadId: string, driverId: string, signal: AbortSignal): Promise<ThreadContext> {
  if (role === 'driver') {
    const { load } = await api.loads.get(loadId, { signal });
    return { load, counterpart: { name: load.shipperName, company: load.shipperCompany, role: 'shipper' } };
  }
  const [{ load }, driver] = await Promise.all([api.loads.get(loadId, { signal }), api.drivers.get(driverId, { signal })]);
  return { load, counterpart: { name: driver.name, company: driver.company, role: 'driver' } };
}

// ---------------------------------------------------------------------------
// Header: who you are talking to and which load it is about
// ---------------------------------------------------------------------------

interface ConversationHeaderProps {
  context: ThreadContext | undefined;
  status: LoadStatus | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  showBack: boolean;
  loadHref: string;
}

function ConversationHeader({ context, status, loading, error, onRetry, showBack, loadHref }: ConversationHeaderProps) {
  const back = showBack ? (
    <Link to={paths.messages} className="cm-convo__back" aria-label="Back to all messages">
      <Icon name="chevronLeft" size={24} />
    </Link>
  ) : null;

  if (!context) {
    return (
      <header className="cm-convo__head">
        <div className="cm-convo__who">
          {back}
          {loading ? (
            <div className="cm-convo__who-text" aria-busy="true" aria-label="Loading conversation details">
              <Skeleton width={160} height={18} />
              <Skeleton width={110} height={13} />
            </div>
          ) : (
            <h2 className="cm-convo__name">Conversation</h2>
          )}
        </div>
        {error ? <ErrorState compact error={error} title="Couldn’t load the load details" onRetry={onRetry} /> : null}
      </header>
    );
  }

  const { load, counterpart } = context;
  const subtitle = [counterpart.company, counterpartRoleLabel(counterpart.role)].filter(Boolean).join(' · ');
  return (
    <header className="cm-convo__head">
      <div className="cm-convo__who">
        {back}
        <Avatar name={counterpart.name} />
        <div className="cm-convo__who-text">
          <h2 className="cm-convo__name truncate">{counterpart.name}</h2>
          <p className="cm-convo__sub truncate">{subtitle}</p>
        </div>
      </div>
      <div className="cm-context">
        <div className="cm-context__top">
          <p className="cm-context__lane lane">
            <span className="lane__city">{place(load.origin)}</span>
            <span className="lane__arrow" aria-label="to">
              <Icon name="arrowRight" size={16} />
            </span>
            <span className="lane__city">{place(load.destination)}</span>
          </p>
          <ButtonLink to={loadHref} variant="secondary" size="sm" iconAfter="chevronRight" className="cm-context__link">
            View load
          </ButtonLink>
        </div>
        <ul className="cm-context__facts">
          {status ? (
            <li>
              <StatusBadge kind="load" status={status} />
            </li>
          ) : null}
          <li>
            <span className="muted">Pickup</span> <span className="num">{pickupTime(load.pickupStart)}</span>
          </li>
          <li className="strong num">{money(load.rateUsd)}</li>
          <li className="muted truncate cm-context__commodity">{load.commodity}</li>
        </ul>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function MessageLog({ messages, viewerId, now }: { messages: Message[]; viewerId: string; now: Date }) {
  return (
    <ol className="cm-log__list">
      {groupByDay(messages, now).map((group) => (
        <li key={group.key} className="cm-day">
          <h3 className="cm-day__label">
            <span>{group.label}</span>
          </h3>
          <ol className="cm-day__list">
            {group.messages.map((message, i) => {
              const mine = message.senderId === viewerId;
              const follows = i > 0 && group.messages[i - 1].senderId === message.senderId;
              return (
                <li key={message.id} className={cx('cm-msg', mine ? 'cm-msg--mine' : 'cm-msg--theirs', follows && 'cm-msg--follow')}>
                  <span className="visually-hidden">{mine ? 'You' : message.senderName}: </span>
                  <p className="cm-msg__bubble">{message.body}</p>
                  <time className="cm-msg__time num" dateTime={message.createdAt}>
                    {clockTime(message.createdAt)}
                  </time>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function EmptyConversation({ role, recipient, onPick }: { role: Role; recipient: string; onPick: (text: string) => void }) {
  return (
    <div className="cm-start">
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name="message" size={28} />
      </span>
      <h3 className="cm-start__title">Start the conversation</h3>
      <p className="muted cm-start__body">
        {role === 'driver'
          ? `Ask ${recipient} about pickup times, the freight or the rate.`
          : `Send ${recipient} the details or ask when they can roll.`}
      </p>
      <div className="cm-start__chips" role="group" aria-label="Quick openers">
        {STARTERS[role].map((text) => (
          <Chip key={text} onClick={() => onPick(text)}>
            {text}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="cm-log cm-log--skeleton" aria-busy="true" aria-label="Loading messages" role="status">
      <Skeleton width="55%" height={44} radius="14px" />
      <Skeleton width="40%" height={44} radius="14px" className="cm-skel--mine" />
      <Skeleton width="65%" height={60} radius="14px" />
      <Skeleton width="35%" height={44} radius="14px" className="cm-skel--mine" />
    </div>
  );
}
