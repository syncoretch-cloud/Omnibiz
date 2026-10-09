// Light/dark theme with a circular "reveal" transition (View Transitions API where available).
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const listeners = new Set<() => void>();

function stored(): Theme | '' {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : '';
  } catch {
    return '';
  }
}

let current: Theme | '' = stored();
const media = window.matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', () => listeners.forEach((l) => l()));

export function effectiveTheme(): Theme {
  return current || (media.matches ? 'dark' : 'light');
}

function apply(t: Theme) {
  current = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* storage unavailable — theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

export function toggleTheme(at?: { clientX: number; clientY: number }) {
  const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  const doc = document as DocWithVT;
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return apply(next);
  const x = at?.clientX ?? window.innerWidth - 40;
  const y = at?.clientY ?? 40;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => apply(next));
  t.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => {});
}

export function initTheme() {
  if (current) document.documentElement.dataset.theme = current;
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    effectiveTheme,
  );
}
