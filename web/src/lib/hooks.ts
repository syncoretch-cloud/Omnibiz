import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api.ts';
import type { Json } from './api.ts';

/** Fired to refresh the screen you are on (re-tapping Home, pulling down). */
export const REFRESH_EVENT = 'omnibiz:refresh';

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

/** True while the person is scrolling down the page, false as soon as they scroll back up or reach the top (phones hide their bars meanwhile). */
export function useScrollHide(enabled = true) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const d = y - last;
        const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
        if (y < 90 || d < -6 || nearBottom) setHidden(false);
        else if (d > 10) setHidden(true);
        if (Math.abs(d) > 6) last = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return hidden;
}

/** Pull down from the top of the page to refresh. `pull` is the damped drag distance (px); `state` drives the indicator. */
export function usePullToRefresh(onRefresh: () => void | Promise<unknown>, enabled = true) {
  const [pull, setPull] = useState(0);
  const [state, setState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  useEffect(() => {
    if (!enabled || !matchMedia('(pointer: coarse)').matches) return;
    const THRESHOLD = 72;
    // Keep the browser's own pull-to-refresh out of the way while ours is active.
    document.documentElement.classList.add('ptr');
    let startY = 0;
    let dragging = false;
    let current = 0;
    const reset = () => {
      dragging = false;
      current = 0;
      setPull(0);
      setState('idle');
    };
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dragging = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (current) reset();
        return;
      }
      current = Math.min(110, dy * 0.5);
      setPull(current);
      setState(current >= THRESHOLD ? 'ready' : 'pulling');
    };
    const onEnd = async () => {
      if (!dragging) return;
      const go = current >= THRESHOLD;
      dragging = false;
      if (!go) return reset();
      setPull(THRESHOLD - 18);
      setState('refreshing');
      try {
        await Promise.all([cb.current(), new Promise((r) => setTimeout(r, 700))]);
      } finally {
        reset();
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', reset);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', reset);
      document.documentElement.classList.remove('ptr');
    };
  }, [enabled]);
  return { pull, state };
}
