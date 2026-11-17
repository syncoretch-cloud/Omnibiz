import { useEffect, useState } from 'react';

/** How long the logo stays on screen before the app appears (people who ask for reduced motion get a short one). */
const SPLASH_MS = 4500;

/**
 * Start-up splash: the logo glows in on black, stays for SPLASH_MS, then fades to reveal the app.
 * Shown every time the app is opened, and never before the app has finished starting.
 */
export function useSplash(ready: boolean) {
  const [phase, setPhase] = useState<'show' | 'leaving' | 'done'>('show');
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    if (phase !== 'show') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setMinElapsed(true), reduced ? 500 : SPLASH_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'show' && minElapsed && ready) {
      setPhase('leaving');
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
      <div className="splash-mark">
        <div style={{ position: 'relative', width: '100%' }}>
          <img className="splash-logo" src="/brand/omnibiz-logo.png" alt="OmniBiz" />
          <span className="splash-shine" />
        </div>
        <div className="splash-bar"><i /></div>
      </div>
    </div>
  );
}
