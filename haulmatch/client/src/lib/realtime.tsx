import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { AppNotification, ServerEvent } from '../../../shared/types';
import { useToast } from '../components/Toast';
import { api } from './api';
import { useAuth } from './auth';

export type RealtimeStatus = 'offline' | 'connecting' | 'open';

type Handler = (event: ServerEvent) => void;

export interface RealtimeContextValue {
  /** Unread notifications for the bell badge. */
  unreadCount: number;
  /** Set after marking notifications read (POST /api/notifications/read returns the new count). */
  setUnreadCount: (count: number) => void;
  /** Re-read the unread count from the server. */
  refreshUnread: () => Promise<void>;
  status: RealtimeStatus;
  /** Low-level subscription; prefer the useServerEvent hook. Returns an unsubscribe function. */
  subscribe: (handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** A message toast is noise when that conversation is already on screen: the message shows up in it. */
const isAlreadyOnScreen = (notification: AppNotification, pathname: string) =>
  notification.type === 'message' && notification.link === pathname;

/**
 * Keeps one EventSource on /api/events open while signed in, reconnecting with exponential
 * backoff. Incoming notifications bump the unread count and show a toast. Sits inside
 * AuthProvider and ToastProvider.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<RealtimeStatus>('offline');
  const handlers = useRef(new Set<Handler>());
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const userId = user?.id ?? null;

  const refreshUnread = useCallback(async () => {
    try {
      const res = await api.notifications.list({ unread: true, limit: 1 });
      setUnreadCount(res.unreadCount);
    } catch {
      // Badge stays as is; the next event or reconnect refreshes it.
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setStatus('offline');
      return;
    }
    void refreshUnread();

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = MIN_RETRY_MS;
    let stopped = false;
    let connectedBefore = false;

    const onMessage = (msg: MessageEvent<string>) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      if (event.type === 'hello') {
        retryMs = MIN_RETRY_MS;
        setStatus('open');
        // Anything that arrived while disconnected is only visible through the count.
        if (connectedBefore) void refreshUnread();
        connectedBefore = true;
      } else if (event.type === 'notification') {
        setUnreadCount((n) => n + 1);
        const { title, body, link } = event.notification;
        if (!isAlreadyOnScreen(event.notification, pathnameRef.current)) {
          toastRef.current.show({ title, body: body || undefined, link: link ? { to: link, label: 'View' } : undefined });
        }
      }
      for (const handler of handlers.current) handler(event);
    };

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      source = new EventSource('/api/events');
      source.onmessage = onMessage;
      source.onerror = () => {
        // Take over from the browser's fixed retry so we can back off and re-check the session.
        source?.close();
        source = null;
        if (stopped) return;
        setStatus('connecting');
        // EventSource hides the HTTP status; a plain request surfaces a 401 (expired session),
        // which signs the user out and stops this loop.
        void refreshUnread();
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      setStatus('offline');
    };
  }, [userId, refreshUnread]);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ unreadCount, setUnreadCount, refreshUnread, status, subscribe }),
    [unreadCount, refreshUnread, status, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return ctx;
}

/**
 * React to live server events. The handler can change every render; only the latest is called.
 *
 *   useServerEvent((e) => {
 *     if (e.type === 'load_updated' && e.loadId === id) reload();
 *   });
 */
export function useServerEvent(handler: Handler): void {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
