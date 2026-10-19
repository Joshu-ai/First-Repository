// In-memory sliding-window counters (failed sign-ins, messages sent). Per app instance, so tests stay isolated.

/** Keys whose events have all aged out are dropped at most this often, so each event costs O(1) however many keys there are. */
export const THROTTLE_SWEEP_INTERVAL_MS = 60_000;

export interface ThrottleOptions {
  /** Events allowed per key inside the window. */
  max: number;
  windowMs: number;
  now: () => Date;
}

export interface Throttle {
  /** Seconds until key may go again, counting attempts still in flight; 0 when it may go now. */
  retryAfterSeconds(key: string): number;
  /**
   * Claims one attempt for key before slow async work (a password check) starts, so attempts that
   * arrive together count against the limit instead of all passing the check first. Returns the
   * function to call once the attempt has finished, or null when key is at its limit.
   */
  reserve(key: string): (() => void) | null;
  /** Counts one event (a failed attempt, a message sent) for key. */
  record(key: string): void;
  /** Forgets key's events, e.g. after a successful sign-in. Attempts in flight still count until released. */
  clear(key: string): void;
  /** Keys tracked and sweeps run so far, for tests. */
  stats(): { keys: number; sweeps: number };
}

export function createThrottle({ max, windowMs, now }: ThrottleOptions): Throttle {
  const events = new Map<string, number[]>();
  const inFlight = new Map<string, number>();
  let lastSweepAt = now().getTime();
  let sweeps = 0;

  // Lists stay short: a key is refused once it holds `max` events, so it never gets past that.
  const recent = (key: string, at: number): number[] => {
    const list = events.get(key);
    if (!list) return [];
    const cutoff = at - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length > 0) events.set(key, kept);
    else events.delete(key);
    return kept;
  };

  // A timed sweep, not one on every event: during a flood nothing inside the window can expire, so
  // sweeping on each event would cost O(keys) per event for nothing.
  const sweepIfDue = (at: number) => {
    if (at - lastSweepAt < THROTTLE_SWEEP_INTERVAL_MS) return;
    lastSweepAt = at;
    sweeps += 1;
    for (const key of [...events.keys()]) recent(key, at);
  };

  const retryAfterSeconds = (key: string): number => {
    const at = now().getTime();
    const kept = recent(key, at);
    if (kept.length + (inFlight.get(key) ?? 0) < max) return 0;
    // Only attempts still running are in the way, and those finish in well under a second.
    if (kept.length < max) return 1;
    const unblockAt = kept[kept.length - max] + windowMs;
    return Math.max(1, Math.ceil((unblockAt - at) / 1000));
  };

  return {
    retryAfterSeconds,
    reserve(key) {
      if (retryAfterSeconds(key) > 0) return null;
      inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (inFlight.get(key) ?? 1) - 1;
        if (left > 0) inFlight.set(key, left);
        else inFlight.delete(key);
      };
    },
    record(key) {
      const at = now().getTime();
      sweepIfDue(at);
      events.set(key, [...recent(key, at), at]);
    },
    clear(key) {
      events.delete(key);
    },
    stats: () => ({ keys: events.size, sweeps }),
  };
}
