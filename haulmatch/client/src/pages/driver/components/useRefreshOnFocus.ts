import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` when the tab or app comes back to the foreground (drivers switch to maps and
 * calls a lot), at most once per `minIntervalMs`.
 */
export function useRefreshOnFocus(refresh: () => void, minIntervalMs = 15_000): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const last = useRef(Date.now());

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last.current < minIntervalMs) return;
      last.current = now;
      refreshRef.current();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [minIntervalMs]);
}

/** Runs `fn` once, `delayMs` after the last call; bursts of live events cause one reload. */
export function useCoalesced(fn: () => void, delayMs = 400): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const trigger = useRef(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), delayMs);
  });
  return trigger.current;
}
