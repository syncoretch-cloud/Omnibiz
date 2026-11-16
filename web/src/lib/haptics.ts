// A tiny tap of vibration on devices that support it (Android browsers); a no-op elsewhere and for people who prefer reduced motion.
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(pattern: number | number[] = 8) {
  try {
    if (!reduced()) navigator.vibrate?.(pattern);
  } catch { /* vibration unavailable */ }
}

/** Distinct feels: a light tick for navigation, a double tap for a like, a firm buzz for a refresh. */
export const tick = () => haptic(6);
export const thump = () => haptic([10, 40, 14]);
export const buzz = () => haptic(18);
