import { describe, expect, it } from 'vitest';
import { appendMessage, prependOlder, withNewestPage } from '../../client/src/pages/common/components/threads';
import type { Message } from '../../shared/types';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 18, 12, minute)).toISOString();
const msg = (n: number): Message => ({
  id: `m${n}`,
  loadId: 'l1',
  driverId: 'd1',
  senderId: n % 2 ? 'd1' : 's1',
  senderName: n % 2 ? 'Driver' : 'Shipper',
  body: `Message ${n}`,
  createdAt: at(n),
  readAt: null,
});
const ids = (list: Message[]) => list.map((m) => m.id);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

describe('conversation pages', () => {
  it('puts an earlier page in front of what is shown, once', () => {
    expect(ids(prependOlder(range(4, 6), range(1, 3)))).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(ids(prependOlder(range(3, 6), range(1, 3)))).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    const shown = range(4, 6);
    expect(prependOlder(shown, [])).toBe(shown);
  });

  it('keeps the earlier pages and later live messages when the newest page is read again', () => {
    // m1-m3 came from "Load earlier messages", m4-m6 from the first page, m8 arrived live.
    const shown = [...range(1, 6), msg(8)];
    // After a dropped connection the newest page is read again; m7 was sent while offline.
    expect(ids(withNewestPage(shown, range(4, 7)))).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(ids(withNewestPage([], range(1, 3)))).toEqual(['m1', 'm2', 'm3']);
    expect(withNewestPage(shown, [])).toBe(shown);
  });

  it('still folds live messages in order', () => {
    expect(ids(appendMessage(range(1, 2), msg(3)))).toEqual(['m1', 'm2', 'm3']);
    expect(ids(appendMessage([msg(1), msg(3)], msg(2)))).toEqual(['m1', 'm2', 'm3']);
  });
});
