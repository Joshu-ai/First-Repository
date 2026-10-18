import { useEffect, useRef } from 'react';
import type { ServerEvent } from '../../../../../shared/types';
import { useServerEvent } from '../../../lib/realtime';

/**
 * Calls `reload` once, shortly after a burst of matching server events. Accepting one request
 * fires several events at once (the booking, the other declined requests, the load and a
 * notification), so they are coalesced into a single refetch.
 */
export function useLiveReload(matches: (event: ServerEvent) => boolean, reload: () => void, delayMs = 250): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => () => clearTimeout(timer.current), []);

  useServerEvent((event) => {
    if (!matches(event)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reloadRef.current(), delayMs);
  });
}

/** Notification links point at client routes such as /shipper/loads/<id>. */
export function notificationLoadId(event: ServerEvent): string | null {
  if (event.type !== 'notification') return null;
  const match = /^\/shipper\/loads\/([^/?#]+)/.exec(event.notification.link ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}
