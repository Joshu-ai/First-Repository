import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useRouteError } from 'react-router';
import { AppShell, PublicShell } from './components/AppShell';
import { ButtonLink, Button } from './components/Button';
import { PageLoader } from './components/Feedback';
import { Icon } from './components/Icon';
import { RequireRole } from './components/RequireRole';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { homePathFor, paths } from './lib/routes';

const Landing = lazy(() => import('./pages/public/Landing'));
const Login = lazy(() => import('./pages/public/Login'));
const Signup = lazy(() => import('./pages/public/Signup'));
const NotFound = lazy(() => import('./pages/public/NotFound'));

const DriverSetup = lazy(() => import('./pages/driver/Setup'));
const LoadBoard = lazy(() => import('./pages/driver/LoadBoard'));
const DriverLoadDetail = lazy(() => import('./pages/driver/LoadDetail'));
const Trips = lazy(() => import('./pages/driver/Trips'));
const Alerts = lazy(() => import('./pages/driver/Alerts'));
const DriverProfile = lazy(() => import('./pages/driver/Profile'));

const ShipperDashboard = lazy(() => import('./pages/shipper/Dashboard'));
const PostLoad = lazy(() => import('./pages/shipper/PostLoad'));
const ShipperLoadDetail = lazy(() => import('./pages/shipper/LoadDetail'));

const Messages = lazy(() => import('./pages/common/Messages'));
const Notifications = lazy(() => import('./pages/common/Notifications'));
const Account = lazy(() => import('./pages/common/Account'));

/** Providers that need the router (toasts render links; realtime shows toasts). */
function Root() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RealtimeProvider>
          <ScrollRestoration />
          <Outlet />
        </RealtimeProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

/** "/": the landing page for visitors, the role home for signed-in users. */
function HomeRoute() {
  const { user, driverProfile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (user) return <Navigate to={homePathFor(user, driverProfile)} replace />;
  return (
    <PublicShell>
      <Landing />
    </PublicShell>
  );
}

/** Pages reachable signed in or out (404) use whichever shell fits the visitor. */
function AdaptiveShell() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  return user ? <AppShell /> : <PublicShell />;
}

function SignedInShell({ children }: { children?: ReactNode }) {
  return <RequireRole>{children ?? <AppShell />}</RequireRole>;
}

/** Shown when a route throws or a lazy page chunk fails to download (e.g. after a deploy). */
function RouteError() {
  const error = useRouteError();
  console.error(error);
  return (
    <div className="container page">
      <div className="error-state" role="alert">
        <span className="error-state__icon" aria-hidden="true">
          <Icon name="warning" size={28} />
        </span>
        <div className="error-state__text">
          <h1 className="error-state__title">This page hit a pothole</h1>
          <p className="error-state__body">Something broke while loading it. Reloading usually fixes it.</p>
        </div>
        <div className="row">
          <Button onClick={() => window.location.reload()} icon="refresh">
            Reload
          </Button>
          <ButtonLink to={paths.home} variant="secondary" reloadDocument>
            Go home
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomeRoute /> },
      {
        element: <PublicShell />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/signup', element: <Signup /> },
        ],
      },
      {
        element: <SignedInShell />,
        errorElement: <RouteError />,
        children: [
          {
            element: <RequireRole role="driver" />,
            children: [
              { path: '/driver', element: <Navigate to={paths.driverLoads} replace /> },
              { path: '/driver/setup', element: <DriverSetup /> },
              { path: '/driver/loads', element: <LoadBoard /> },
              { path: '/driver/loads/:id', element: <DriverLoadDetail /> },
              { path: '/driver/trips', element: <Trips /> },
              { path: '/driver/alerts', element: <Alerts /> },
              { path: '/driver/profile', element: <DriverProfile /> },
            ],
          },
          {
            element: <RequireRole role="shipper" />,
            children: [
              { path: '/shipper', element: <ShipperDashboard /> },
              { path: '/shipper/loads', element: <Navigate to={paths.shipperHome} replace /> },
              { path: '/shipper/loads/new', element: <PostLoad /> },
              { path: '/shipper/loads/:id', element: <ShipperLoadDetail /> },
              { path: '/shipper/loads/:id/edit', element: <PostLoad /> },
            ],
          },
          { path: '/messages', element: <Messages /> },
          { path: '/messages/:loadId/:driverId', element: <Messages /> },
          { path: '/notifications', element: <Notifications /> },
          { path: '/account', element: <Account /> },
        ],
      },
      {
        element: <AdaptiveShell />,
        children: [{ path: '*', element: <NotFound /> }],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
