import { lazy, Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { useSession, isBusinessType } from './lib/session.tsx';
import { Ambient, AppLayout, MobileMenu } from './components/Layout.tsx';
import { Spinner } from './components/ui.tsx';
import { Splash, useSplash } from './components/Splash.tsx';
import { AuthShell } from './pages/Auth.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { Home } from './pages/Home.tsx';
import { PostPage } from './pages/PostPage.tsx';
import { NotFound } from './pages/NotFound.tsx';

// Larger areas load on demand to keep the first screen fast on mobile networks.
const Reels = lazy(() => import('./pages/Reels.tsx'));
const Explore = lazy(() => import('./pages/Explore.tsx'));
const Jobs = lazy(() => import('./pages/Jobs.tsx'));
const JobDetail = lazy(() => import('./pages/JobDetail.tsx'));
const Businesses = lazy(() => import('./pages/Businesses.tsx'));
const Marketplace = lazy(() => import('./pages/Marketplace.tsx'));
const ProductDetail = lazy(() => import('./pages/ProductDetail.tsx'));
const Compare = lazy(() => import('./pages/Compare.tsx'));
const Cart = lazy(() => import('./pages/Cart.tsx'));
const Orders = lazy(() => import('./pages/Orders.tsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.tsx'));
const Search = lazy(() => import('./pages/Search.tsx'));
const Notifications = lazy(() => import('./pages/Notifications.tsx'));
const Messages = lazy(() => import('./pages/Messages.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const Saved = lazy(() => import('./pages/Saved.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard.tsx'));
const Admin = lazy(() => import('./pages/admin/Admin.tsx'));

/** New pages open at the top; going Back returns to exactly where you were (waiting for the page to be tall enough again). */
const scrollMemory = new Map<string, number>();
const readY = () => Math.max(window.scrollY, document.getElementById('app-scroll')?.scrollTop ?? 0);
function ScrollTop() {
  const loc = useLocation();
  const type = useNavigationType();
  const keyRef = useRef(loc.key);
  // Track the position of whichever page is showing (the window on phones, the content panel on bigger screens).
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onScroll = () => scrollMemory.set(keyRef.current, readY());
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
  useEffect(() => {
    keyRef.current = loc.key;
    const target = type === 'POP' ? scrollMemory.get(loc.key) : undefined;
    const go = (y: number) => {
      window.scrollTo(0, y);
      document.getElementById('app-scroll')?.scrollTo(0, y);
    };
    if (!target) {
      go(0);
      scrollMemory.set(loc.key, 0);
      return;
    }
    let tries = 0;
    const id = setInterval(() => {
      go(target);
      if (Math.abs(readY() - target) < 4 || ++tries > 25) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [loc.key, type]);
  return null;
}

/** The CV lives in your profile now; old links and bookmarks to /me/cv land on it. */
function CvRedirect() {
  const { me } = useSession();
  return <Navigate to={`/u/${me?.user.username}?tab=about`} replace />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const loc = useLocation();
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!me.user.onboarded && loc.pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function RequireBusiness({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return isBusinessType(me?.user.account_type) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  const { me, ready } = useSession();
  const splash = useSplash(ready);
  return (
    <>
      <Ambient />
      {splash !== 'done' && <Splash leaving={splash === 'leaving'} />}
      {!ready ? <Spinner block /> : (
        <Suspense fallback={<Spinner block />}>
          <ScrollTop />
          <Routes>
            <Route path="/login" element={me ? <Navigate to="/" replace /> : <AuthShell mode="login" />} />
            <Route path="/register" element={me ? <Navigate to="/" replace /> : <AuthShell mode="register" />} />
            <Route path="/recover" element={<AuthShell mode="recover" />} />
            <Route path="/welcome" element={<RequireAuth><Onboarding /></RequireAuth>} />
            {!me && <Route path="/" element={<AuthShell mode="login" />} />}
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route path="/" element={<Home />} />
              <Route path="/reels" element={<Reels />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/menu" element={<MobileMenu />} />
              <Route path="/posts/:id" element={<PostPage />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/businesses" element={<Businesses />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/marketplace/compare" element={<Compare />} />
              <Route path="/marketplace/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/search" element={<Search />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/messages/:id" element={<Messages />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/me/cv" element={<CvRedirect />} />
              <Route path="/saved" element={<Saved />} />
              <Route path="/settings/*" element={<Settings />} />
              <Route path="/dashboard/*" element={<RequireBusiness><Dashboard /></RequireBusiness>} />
              <Route path="/admin/*" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      )}
    </>
  );
}
