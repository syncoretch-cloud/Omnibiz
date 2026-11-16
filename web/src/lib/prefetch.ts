// Pages load on demand, so the first tap on a destination waits for its code. Starting that download when a finger or
// pointer approaches the link makes the navigation feel instant. Each loader is imported once and the result is cached.
const LOADERS: [RegExp, () => Promise<unknown>][] = [
  [/^\/reels/, () => import('../pages/Reels.tsx')],
  [/^\/explore/, () => import('../pages/Explore.tsx')],
  [/^\/jobs\/\d+/, () => import('../pages/JobDetail.tsx')],
  [/^\/jobs/, () => import('../pages/Jobs.tsx')],
  [/^\/businesses/, () => import('../pages/Businesses.tsx')],
  [/^\/marketplace\/compare/, () => import('../pages/Compare.tsx')],
  [/^\/marketplace\/\d+/, () => import('../pages/ProductDetail.tsx')],
  [/^\/marketplace/, () => import('../pages/Marketplace.tsx')],
  [/^\/cart/, () => import('../pages/Cart.tsx')],
  [/^\/orders\/\d+/, () => import('../pages/OrderDetail.tsx')],
  [/^\/orders/, () => import('../pages/Orders.tsx')],
  [/^\/search/, () => import('../pages/Search.tsx')],
  [/^\/notifications/, () => import('../pages/Notifications.tsx')],
  [/^\/messages/, () => import('../pages/Messages.tsx')],
  [/^\/u\//, () => import('../pages/Profile.tsx')],
  [/^\/saved/, () => import('../pages/Saved.tsx')],
  [/^\/settings/, () => import('../pages/Settings.tsx')],
  [/^\/dashboard/, () => import('../pages/dashboard/Dashboard.tsx')],
  [/^\/admin/, () => import('../pages/admin/Admin.tsx')],
];
const started = new Set<() => Promise<unknown>>();

export function prefetchRoute(to: string) {
  const hit = LOADERS.find(([re]) => re.test(to));
  if (!hit || started.has(hit[1])) return;
  started.add(hit[1]);
  hit[1]().catch(() => started.delete(hit[1]));
}

/** Props to spread on a link: warm the destination on hover, focus or touch. */
export const warm = (to: string) => ({
  onPointerEnter: () => prefetchRoute(to),
  onFocus: () => prefetchRoute(to),
  onTouchStart: () => prefetchRoute(to),
});
