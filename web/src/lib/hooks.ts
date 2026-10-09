import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api.ts';
import type { Json } from './api.ts';

/** Fetches `path` (skips when null) and refetches when it changes. */
export function useApi<T = Json>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    get<T>(path, ctrl.signal)
      .then((d) => setData(d))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, setData, error, loading, reload };
}

/** Paginated list with "load more". `key` selects the array field in the response. */
export function usePaged<T = Json>(path: string | null, key = 'items') {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [extra, setExtra] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const countRef = useRef(0);
  const sep = path?.includes('?') ? '&' : '?';

  useEffect(() => {
    setItems([]);
    setPage(1);
  }, [path, tick]);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    get(`${path}${sep}page=${page}`, ctrl.signal)
      .then((d) => {
        const list = (d[key] ?? []) as T[];
        const loaded = (page === 1 ? 0 : countRef.current) + list.length;
        countRef.current = loaded;
        setItems((prev) => {
          if (page === 1) return list;
          // Ranked feeds can shift between pages; never show the same item twice.
          const idOf = (x: T) => (x as Json)?.key ?? (x as Json)?.id;
          const seen = new Set(prev.map(idOf).filter((id) => id != null));
          return [...prev, ...list.filter((x) => idOf(x) == null || !seen.has(idOf(x)))];
        });
        setHasMore(d.hasMore ?? (typeof d.total === 'number' ? loaded < d.total && list.length > 0 : false));
        setExtra(d);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, page, tick]);

  const loadMore = useCallback(() => setPage((p) => p + 1), []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { items, setItems, loading, error, hasMore, extra, loadMore, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mql = window.matchMedia(q);
    const on = () => setM(mql.matches);
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [q]);
  return m;
}
