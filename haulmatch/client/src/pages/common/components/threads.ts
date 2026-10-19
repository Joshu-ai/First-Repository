// Pure helpers for the Messages page: thread identity, ordering and merging live messages.
import type { Message, Role, Thread } from '../../../../../shared/types';
import { calendarDayDiff, dayLabel } from '../../../lib/format';

/** Who is on the other side of a conversation, for its header. */
export interface Counterpart {
  name: string;
  company: string | null;
  role: Role;
}

/** Everything the conversation header needs, whether it came from the thread list or the load. */
export interface ThreadContext {
  load: Thread['load'];
  counterpart: Counterpart;
}

/** A thread is one load + one driver; this is its identity. */
export function threadKey(loadId: string, driverId: string): string {
  return `${loadId}:${driverId}`;
}

export function keyOf(thread: Pick<Thread, 'loadId' | 'driverId'>): string {
  return threadKey(thread.loadId, thread.driverId);
}

function lastActivity(thread: Thread): string {
  return thread.lastMessage?.createdAt ?? '';
}

/** Most recent activity first. ISO timestamps in UTC sort correctly as strings; ties keep their order. */
export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}

export function findThread(threads: Thread[] | undefined, key: string | null): Thread | undefined {
  if (!threads || !key) return undefined;
  return threads.find((t) => keyOf(t) === key);
}

/**
 * Fold a new message into the list: it becomes the thread's last message, bumps the unread
 * count when someone else sent it to a thread that is not on screen, and the list re-sorts.
 * Returns the list unchanged when the thread is not in it (the caller reloads to pick it up).
 */
export function applyMessage(threads: Thread[], message: Message, viewerId: string, openKey: string | null): Thread[] {
  const key = threadKey(message.loadId, message.driverId);
  const index = threads.findIndex((t) => keyOf(t) === key);
  if (index < 0) return threads;
  const thread = threads[index];
  // The POST response and the live event both deliver the sender's own message.
  if (thread.lastMessage?.id === message.id) return threads;
  const counts = message.senderId !== viewerId && key !== openKey;
  const newer = !thread.lastMessage || message.createdAt >= thread.lastMessage.createdAt;
  const next = [...threads];
  next[index] = {
    ...thread,
    lastMessage: newer ? message : thread.lastMessage,
    unreadCount: counts ? thread.unreadCount + 1 : thread.unreadCount,
  };
  return sortThreads(next);
}

export function clearUnread(threads: Thread[], key: string): Thread[] {
  const index = threads.findIndex((t) => keyOf(t) === key);
  if (index < 0 || threads[index].unreadCount === 0) return threads;
  const next = [...threads];
  next[index] = { ...threads[index], unreadCount: 0 };
  return next;
}

/** Append without duplicates, oldest first. */
export function appendMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  const next = [...messages, message];
  // Live events can land before an older POST response; keep chronological order.
  if (messages.length > 0 && message.createdAt < messages[messages.length - 1].createdAt) {
    next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return next;
}

/** An older page joined in front of what is shown (pages never overlap, but skip repeats anyway). */
export function prependOlder(messages: Message[], older: Message[]): Message[] {
  const seen = new Set(messages.map((m) => m.id));
  const fresh = older.filter((m) => !seen.has(m.id));
  return fresh.length ? [...fresh, ...messages] : messages;
}

/**
 * A fresh read of the newest page joined to what is shown: earlier pages the person loaded stay in
 * front of it, the page replaces its own span, and live messages newer than it stay after it.
 */
export function withNewestPage(messages: Message[], page: Message[]): Message[] {
  if (page.length === 0) return messages;
  const inPage = new Set(page.map((m) => m.id));
  const start = page[0].createdAt;
  const rest = messages.filter((m) => !inPage.has(m.id));
  const before = rest.filter((m) => m.createdAt < start);
  const after = rest.filter((m) => m.createdAt >= start);
  return after.reduce(appendMessage, [...before, ...page]);
}

export interface DayGroup {
  key: string;
  label: string;
  messages: Message[];
}

/** Split a conversation into calendar days ("Today", "Yesterday", "Wed, Oct 14") in local time. */
export function groupByDay(messages: Message[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const last = groups[groups.length - 1];
    if (last && calendarDayDiff(date, new Date(last.messages[0].createdAt)) === 0) {
      last.messages.push(message);
    } else {
      groups.push({ key: message.id, label: dayLabel(date, now), messages: [message] });
    }
  }
  return groups;
}

/** "You: On my way" for the viewer's own last message, the plain text otherwise. */
export function previewText(message: Message | null, viewerId: string): string {
  if (!message) return 'No messages yet';
  const text = message.body.replace(/\s+/g, ' ').trim();
  return message.senderId === viewerId ? `You: ${text}` : text;
}

export function counterpartRoleLabel(role: Role): string {
  return role === 'driver' ? 'Driver' : 'Shipper';
}
