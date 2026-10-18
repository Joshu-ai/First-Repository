import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  /** Last successful result; kept while reloading so lists do not flash empty. */
  data: T | undefined;
  error: unknown;
  /** True while a request is in flight (first load or reload). */
  loading: boolean;
  /** Re-run the loader. Resolves when it settles; never throws. */
  reload: () => Promise<void>;
  /** Replace data locally, e.g. after a mutation returned the updated object. */
  setData: (next: T | undefined | ((prev: T | undefined) => T | undefined)) => void;
}

export interface AsyncOptions {
  /** When false the loader does not run and `loading` is false. Default true. */
  enabled?: boolean;
}

/**
 * Run an async loader whenever `deps` change and track loading/error/data.
 * The loader gets an AbortSignal; pass it to api calls so stale responses are dropped.
 *
 *   const { data, error, loading, reload } = useAsync((signal) => api.loads.get(id, { signal }), [id]);
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: AsyncOptions = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current(controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (err) {
      if (!controller.signal.aborted && !isAbort(err)) setError(err);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void run();
    return () => controllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, error, loading, reload: run, setData };
}

/** Same as useAsync; reads better at call sites that hit the API. */
export const useApi = useAsync;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export interface ActionState<A extends unknown[], R> {
  /**
   * Runs the action. Resolves with the result, or undefined if it threw (the error is in `error`).
   * An action that resolves with nothing (a 204 DELETE) should map success to a value, e.g.
   * `useAction((id) => api.savedSearches.remove(id).then(() => true))`, so failure stays distinguishable.
   */
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * Wrap a mutation (book, accept, cancel...) with pending/error state for buttons.
 *
 *   const book = useAction((id: string) => api.loads.book(id));
 *   <Button loading={book.pending} onClick={() => book.run(load.id)}>Book it</Button>
 */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>): ActionState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  const mounted = useMounted();

  const run = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        return await actionRef.current(...args);
      } catch (err) {
        if (mounted.current) setError(err);
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [mounted],
  );

  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** The value, updated only after it stops changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Live result of a CSS media query, e.g. useMediaQuery('(min-width: 900px)'). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** True at desktop widths (1024px+), where the top nav replaces the bottom tab bar. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/** Sets document.title to "<title> · HaulMatch" (just "HaulMatch" when title is empty). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · HaulMatch` : 'HaulMatch';
  }, [title]);
}

/** Current time, re-rendering every `intervalMs` so "in 3h" style labels stay fresh. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
