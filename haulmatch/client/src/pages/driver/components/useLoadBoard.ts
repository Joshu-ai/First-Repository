import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadSearchFilters, LoadWithMatch } from '../../../../../shared/types';
import { api } from '../../../lib/api';

export const PAGE_SIZE = 20;
/** GET /api/loads caps limit at 200; a refresh re-reads everything already on screen up to that. */
const MAX_LIMIT = 200;

export interface BoardData {
  loads: LoadWithMatch[];
  total: number;
  profileComplete: boolean;
}

export interface LoadBoardState {
  data: BoardData | null;
  /** First page for the current filters is loading (show skeletons). */
  loading: boolean;
  error: unknown;
  /** A background refresh is running (the list stays on screen). */
  refreshing: boolean;
  loadingMore: boolean;
  moreError: unknown;
  reload: () => void;
  refresh: () => void;
  loadMore: () => void;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * Paged load search for the board. `key` identifies the filters (their query string); a new key
 * starts over at page one, `refresh` re-reads what is already shown without flashing skeletons,
 * and `loadMore` appends the next page.
 */
export function useLoadBoard(filters: LoadSearchFilters, key: string): LoadBoardState {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const shown = useRef(0);
  // Bumped whenever the filters change so late "load more" pages for old filters are dropped.
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const fetchFirst = useCallback(async (mode: 'reset' | 'refresh') => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const gen = generation.current;
    if (mode === 'reset') {
      setLoading(true);
      setError(null);
      setMoreError(null);
    } else {
      setRefreshing(true);
    }
    const limit = mode === 'refresh' ? Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, shown.current)) : PAGE_SIZE;
    try {
      const res = await api.loads.list({ ...filtersRef.current, offset: 0, limit }, { signal: c.signal });
      if (c.signal.aborted || gen !== generation.current) return;
      shown.current = res.loads.length;
      setData({ loads: res.loads, total: res.total, profileComplete: res.driverProfileComplete });
      setError(null);
    } catch (err) {
      if (c.signal.aborted || isAbort(err)) return;
      // A failed background refresh keeps the list; the next event or focus tries again.
      if (mode === 'reset') setError(err);
    } finally {
      if (!c.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    shown.current = 0;
    setData(null);
    setLoadingMore(false);
    void fetchFirst('reset');
    return () => controller.current?.abort();
  }, [key, fetchFirst]);

  const loadMore = useCallback(async () => {
    if (!data || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api.loads.list({ ...filtersRef.current, offset: data.loads.length, limit: PAGE_SIZE });
      if (gen !== generation.current) return;
      setData((prev) => {
        if (!prev) return prev;
        const seen = new Set(prev.loads.map((l) => l.id));
        const loads = [...prev.loads, ...res.loads.filter((l) => !seen.has(l.id))];
        shown.current = loads.length;
        return { loads, total: res.total, profileComplete: res.driverProfileComplete };
      });
    } catch (err) {
      if (gen === generation.current) setMoreError(err);
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [data, loadingMore]);

  return {
    data,
    loading,
    error,
    refreshing,
    loadingMore,
    moreError,
    reload: () => void fetchFirst('reset'),
    refresh: () => void fetchFirst('refresh'),
    loadMore: () => void loadMore(),
  };
}
