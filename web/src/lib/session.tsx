import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, post } from './api.ts';
import type { Json } from './api.ts';
import { useInterval } from './hooks.ts';

export interface Me {
  user: Json;
  business: Json | null;
  profile: Json | null;
  interests: string[];
  permissions: string[];
  staff_permissions: string[];
  counts: { notifications: number; messages: number; cart: number };
  features?: { contact_verification: boolean };
}

export interface Meta {
  industries: { slug: string; name: string }[];
  product_categories: { slug: string; name: string }[];
  employment_types: string[];
  education_levels: string[];
  document_kinds: string[];
  post_kinds: string[];
  announcement_kinds: string[];
  pipeline: string[];
  payment_methods: string[];
  report_reasons: string[];
  currencies: string[];
  cities: { name: string; lat: number; lng: number; country: string; region: string }[];
}

interface SessionValue {
  me: Me | null;
  meta: Meta | null;
  ready: boolean;
  setMe: (m: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
  staffCan: (perm: string) => boolean;
  industryName: (slug?: string | null) => string;
  productCategoryName: (slug?: string | null) => string;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);

  const setMe = useCallback((m: Me | null) => setMeState(m && m.user ? m : null), []);

  const refresh = useCallback(async () => {
    try {
      setMe(await get('/auth/me'));
    } catch {
      /* offline or server restarting — keep current state */
    }
  }, [setMe]);

  useEffect(() => {
    Promise.all([get('/auth/me').then(setMe).catch(() => setMe(null)), get('/meta').then(setMeta)]).finally(() => setReady(true));
  }, [setMe]);

  // Keep badge counts fresh.
  useInterval(() => {
    if (me) refresh();
  }, me ? 30_000 : null);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setMe(null);
  }, [setMe]);

  const value = useMemo<SessionValue>(() => {
    const ind = new Map(meta?.industries.map((c) => [c.slug, c.name]));
    const prod = new Map(meta?.product_categories.map((c) => [c.slug, c.name]));
    return {
      me, meta, ready, setMe, refresh, logout,
      can: (p) => !!me?.permissions.includes(p),
      staffCan: (p) => !!me && (me.staff_permissions.includes('*') || me.staff_permissions.includes(p)),
      industryName: (s) => (s ? ind.get(s) ?? s : ''),
      productCategoryName: (s) => (s ? prod.get(s) ?? s : ''),
    };
  }, [me, meta, ready, setMe, refresh, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside provider');
  return ctx;
}

export const isBusinessType = (t?: string) => t === 'company' || t === 'wholesaler' || t === 'retailer';

// ───────────── toasts ─────────────
interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}
const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Wraps an async action: shows errors as toasts and returns the result (or undefined on failure). */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e) {
        toast((e as Error).message, 'error');
        return undefined;
      }
    },
    [toast],
  );
}
