// Live updates: one EventSource per signed-in tab. The server says "notification" or "message" the moment
// something arrives; pages that show that data subscribe with useLive() and reload instead of polling quickly.
import { useEffect, useRef } from 'react';

const EVENT = 'omnibiz:live';

/** Keeps a stream open to /api/live while `enabled`. The browser reconnects by itself if it drops. */
export function useLiveConnection(enabled: boolean, onEvent: (kind: 'notification' | 'message') => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/live');
    const fire = (kind: 'notification' | 'message') => () => {
      cb.current(kind);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
    };
    es.addEventListener('notification', fire('notification'));
    es.addEventListener('message', fire('message'));
    return () => es.close();
  }, [enabled]);
}

/** Runs `fn` whenever a live event of the given kind arrives (any kind when omitted). */
export function useLive(fn: () => void, kind?: 'notification' | 'message') {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: Event) => {
      if (!kind || (e as CustomEvent).detail === kind) ref.current();
    };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, [kind]);
}
