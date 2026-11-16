import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { tick } from './haptics.ts';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

/** The post nearest the middle of the screen, the one j / k / l act on. */
function posts() {
  return Array.from(document.querySelectorAll<HTMLElement>('article.post'));
}
function focusPost(dir: 1 | -1) {
  const list = posts();
  if (!list.length) return;
  const mid = window.innerHeight * 0.4;
  const cur = list.findIndex((p) => p.classList.contains('kb-focus'));
  let i: number;
  if (cur >= 0) i = Math.max(0, Math.min(list.length - 1, cur + dir));
  else i = Math.max(0, list.findIndex((p) => p.getBoundingClientRect().bottom > mid) + (dir === -1 ? -1 : 0));
  list.forEach((p) => p.classList.remove('kb-focus'));
  const next = list[i];
  next.classList.add('kb-focus');
  next.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export const SHORTCUTS: [string, string][] = [
  ['/', 'Search'],
  ['j / k', 'Next / previous post'],
  ['l', 'Like the highlighted post'],
  ['s', 'Save the highlighted post'],
  ['c', 'Create'],
  ['g then h', 'Go to Home'],
  ['g then d', 'Go to Discover'],
  ['g then r', 'Go to Reels'],
  ['g then j', 'Go to Jobs'],
  ['g then p', 'Go to Market'],
  ['g then m', 'Go to Messages'],
  ['g then n', 'Go to Notifications'],
  ['?', 'Show these shortcuts'],
];

/** Keyboard shortcuts for computers: the same keys people know from the best social sites. */
export function useShortcuts(h: { search: () => void; create: () => void; help: () => void; jobs: boolean }) {
  const nav = useNavigate();
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (g && Date.now() - g < 1200) {
        g = 0;
        const to: Record<string, string> = { h: '/', d: '/explore', r: '/reels', m: '/messages', n: '/notifications', s: '/saved', ...(ref.current.jobs ? { j: '/jobs' } : {}), p: '/marketplace' };
        if (to[k]) {
          e.preventDefault();
          tick();
          nav(to[k]);
        }
        return;
      }
      if (k === '/') { e.preventDefault(); ref.current.search(); }
      else if (k === '?') ref.current.help();
      else if (k === 'c') ref.current.create();
      else if (k === 'g') g = Date.now();
      else if (k === 'j') focusPost(1);
      else if (k === 'k') focusPost(-1);
      else if (k === 'l' || k === 's') {
        const cur = document.querySelector<HTMLElement>('article.post.kb-focus');
        cur?.querySelector<HTMLButtonElement>(k === 'l' ? 'button[aria-label="Like"]' : 'button[aria-label="Save"]')?.click();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nav]);
}
