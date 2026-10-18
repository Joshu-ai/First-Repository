import { Link } from 'react-router';
import type { Thread } from '../../../../../shared/types';
import { CountBubble } from '../../../components/Badge';
import { Avatar } from '../../../components/DataDisplay';
import { Skeleton } from '../../../components/Feedback';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../lib/cx';
import { place, plural, timeAgo } from '../../../lib/format';
import { paths } from '../../../lib/routes';
import { keyOf, previewText } from './threads';

export interface ThreadListProps {
  threads: Thread[];
  viewerId: string;
  /** Key of the conversation on screen (highlighted, never shown as unread). */
  activeKey: string | null;
  now: Date;
}

export function ThreadList({ threads, viewerId, activeKey, now }: ThreadListProps) {
  return (
    <ul className="divided cm-threads">
      {threads.map((thread) => (
        <li key={keyOf(thread)}>
          <ThreadRow thread={thread} viewerId={viewerId} active={keyOf(thread) === activeKey} now={now} />
        </li>
      ))}
    </ul>
  );
}

function ThreadRow({ thread, viewerId, active, now }: { thread: Thread; viewerId: string; active: boolean; now: Date }) {
  const { counterpart, load, lastMessage } = thread;
  const unread = active ? 0 : thread.unreadCount;
  return (
    <Link
      to={paths.thread(thread.loadId, thread.driverId)}
      className={cx('cm-thread', active && 'is-active', unread > 0 && 'is-unread')}
      aria-current={active ? 'page' : undefined}
    >
      <Avatar name={counterpart.name} />
      <span className="cm-thread__body">
        <span className="cm-thread__top">
          <span className="cm-thread__who truncate">
            <span className="cm-thread__name">{counterpart.name}</span>
            {counterpart.company ? <span className="cm-thread__company"> · {counterpart.company}</span> : null}
          </span>
          {lastMessage ? (
            <time className="cm-thread__time num" dateTime={lastMessage.createdAt}>
              {timeAgo(lastMessage.createdAt, now)}
            </time>
          ) : null}
        </span>
        <span className="cm-thread__lane truncate">
          {place(load.origin)}
          <Icon name="arrowRight" size={14} className="cm-thread__arrow" />
          <span className="visually-hidden"> to </span>
          {place(load.destination)}
        </span>
        <span className="cm-thread__bottom">
          <span className="cm-thread__preview truncate">{previewText(lastMessage, viewerId)}</span>
          <CountBubble count={unread} label={plural(unread, 'unread message')} />
        </span>
      </span>
    </Link>
  );
}

export function ThreadListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="divided cm-threads" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="cm-thread cm-thread--skeleton" aria-hidden="true">
          <Skeleton width={40} height={40} radius="50%" />
          <span className="cm-thread__body">
            <Skeleton width="55%" height={16} />
            <Skeleton width="70%" height={13} />
            <Skeleton width="85%" height={13} />
          </span>
        </li>
      ))}
    </ul>
  );
}
