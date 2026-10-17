import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
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
const CvEditor = lazy(() => import('./pages/CvEditor.tsx'));
const Saved = lazy(() => import('./pages/Saved.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard.tsx'));
const Admin = lazy(() => import('./pages/admin/Admin.tsx'));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // On a phone the page scrolls; on bigger screens the content panel does.
    window.scrollTo(0, 0);
    document.getElementById('app-scroll')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
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
              <Route path="/me/cv" element={<CvEditor />} />
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
