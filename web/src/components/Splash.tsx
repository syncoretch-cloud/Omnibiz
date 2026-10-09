import { useEffect, useState } from 'react';

const SEEN_KEY = 'omnibiz-splash-seen';

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Start-up splash: the transparent logo glows in over the brand photograph, then fades to reveal the app.
 * Shown once per browser tab session, and only for as long as it takes to start (plus a short beat).
 */
export function useSplash(ready: boolean) {
  const [phase, setPhase] = useState<'show' | 'leaving' | 'done'>(() => (alreadySeen() ? 'done' : 'show'));
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    if (phase !== 'show') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setMinElapsed(true), reduced ? 500 : 2100);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'show' && minElapsed && ready) {
      setPhase('leaving');
      try {
        sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* storage unavailable — the splash simply shows again next load */
      }
    }
  }, [phase, minElapsed, ready]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => setPhase('done'), 850);
    return () => clearTimeout(t);
  }, [phase]);

  return phase;
}

export function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={`splash${leaving ? ' out' : ''}`} role="presentation">
      <div className="splash-photo" />
      <div className="splash-mark">
        <div style={{ position: 'relative', width: '100%' }}>
          <img className="splash-logo" src="/brand/logo.png" alt="OmniBiz" />
          <span className="splash-shine" />
        </div>
        <div className="splash-bar"><i /></div>
      </div>
    </div>
  );
}
