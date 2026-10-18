import { useEffect, useRef } from 'react';
import { api } from '../../../lib/api';
import { useRealtime } from '../../../lib/realtime';

/**
 * Calls `callback` when the live connection comes back after dropping. Events sent while the
 * phone had no signal are lost, so pages re-read their data then. Not called on the first connect.
 */
export function useOnReconnect(callback: () => void): void {
  const { status } = useRealtime();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const wasOpen = useRef(status === 'open');
  const previous = useRef(status);

  useEffect(() => {
    if (status === 'open' && previous.current !== 'open' && wasOpen.current) callbackRef.current();
    if (status === 'open') wasOpen.current = true;
    previous.current = status;
  }, [status]);
}

/** True while this tab is in front, so "seen" only counts when someone could actually see it. */
export function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Marks the unread "new message" notifications that point at one conversation as read, so the
 * bell agrees with what the person just read. Resolves with the new unread total, or null when
 * nothing needed marking.
 */
export async function markThreadNotificationsRead(threadPath: string): Promise<number | null> {
  const { notifications } = await api.notifications.list({ unread: true, limit: 100 });
  const ids = notifications.filter((n) => n.type === 'message' && n.link === threadPath).map((n) => n.id);
  if (ids.length === 0) return null;
  const { unreadCount } = await api.notifications.markRead(ids);
  return unreadCount;
}
