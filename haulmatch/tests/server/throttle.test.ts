import { describe, expect, it } from 'vitest';
import { createThrottle, THROTTLE_SWEEP_INTERVAL_MS } from '../../server/throttle';

const MINUTE = 60_000;

function setup(max = 3, windowMs = 15 * MINUTE) {
  let current = Date.parse('2026-10-18T12:00:00.000Z');
  const throttle = createThrottle({ max, windowMs, now: () => new Date(current) });
  return { throttle, advance: (ms: number) => (current += ms) };
}

describe('createThrottle', () => {
  it('blocks a key once it holds max events, until the oldest ages out', () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(throttle.retryAfterSeconds('a')).toBe(0);
      throttle.record('a');
      advance(MINUTE);
    }
    // The first event was 3 minutes ago, so it ages out in 12.
    expect(throttle.retryAfterSeconds('a')).toBe(12 * 60);
    expect(throttle.retryAfterSeconds('b')).toBe(0);
    advance(12 * MINUTE);
    expect(throttle.retryAfterSeconds('a')).toBe(0);
  });

  it('counts reserved attempts that have not finished yet', () => {
    const { throttle } = setup();
    throttle.record('a');
    const first = throttle.reserve('a');
    const second = throttle.reserve('a');
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    // One recorded plus two in flight is the limit.
    expect(throttle.reserve('a')).toBeNull();
    expect(throttle.retryAfterSeconds('a')).toBe(1);

    second!();
    second!(); // releasing twice frees only one slot
    const third = throttle.reserve('a');
    expect(third).toBeTypeOf('function');
    expect(throttle.reserve('a')).toBeNull();
    first!();
    third!();
    expect(throttle.retryAfterSeconds('a')).toBe(0);
  });

  it('forgets events on clear, while attempts in flight still count', () => {
    const { throttle } = setup();
    throttle.record('a');
    throttle.record('a');
    const release = throttle.reserve('a')!;
    throttle.clear('a');
    expect(throttle.reserve('a')).toBeTypeOf('function');
    expect(throttle.reserve('a')).toBeTypeOf('function');
    expect(throttle.reserve('a')).toBeNull();
    release();
  });

  it('sweeps idle keys on a timer, not on every event', () => {
    const { throttle, advance } = setup(10, 15 * MINUTE);
    // A flood of distinct keys inside one interval triggers no sweep at all.
    for (let i = 0; i < 5_000; i += 1) throttle.record(`flood-${i}@test.example`);
    expect(throttle.stats()).toEqual({ keys: 5_000, sweeps: 0 });

    // Once they have aged out, the next event after the interval drops them in one pass.
    advance(15 * MINUTE + 1);
    throttle.record('late@test.example');
    expect(throttle.stats()).toEqual({ keys: 1, sweeps: 1 });

    for (let i = 0; i < 1_000; i += 1) throttle.record(`second-${i}@test.example`);
    expect(throttle.stats().sweeps).toBe(1);
    advance(THROTTLE_SWEEP_INTERVAL_MS);
    throttle.record('later@test.example');
    expect(throttle.stats()).toEqual({ keys: 1_002, sweeps: 2 });
  });
});
