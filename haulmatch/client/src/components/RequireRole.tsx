import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '../../../shared/types';
import { useAuth } from '../lib/auth';
import { allowedBeforeSetup, homePathFor, paths } from '../lib/routes';
import { PageLoader } from './Feedback';

export interface RequireRoleProps {
  /** Omit to allow any signed-in user (messages, notifications, account). */
  role?: Role;
  /** Rendered when allowed; defaults to the nested route's <Outlet />. */
  children?: ReactNode;
}

/**
 * Route guard. Signed out -> /login?next=<this url> (or / right after an explicit sign-out).
 * Wrong role -> that user's home.
 * Drivers without a complete rig profile -> /driver/setup, except on setup, account,
 * notifications and messages.
 */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { user, driverProfile, loading, signedOut } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) {
    if (signedOut) return <Navigate to={paths.home} replace />;
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={paths.login(next)} replace />;
  }
  if (role && user.role !== role) return <Navigate to={homePathFor(user, driverProfile)} replace />;
  if (user.role === 'driver' && !driverProfile?.profileComplete && !allowedBeforeSetup(location.pathname)) {
    return <Navigate to={paths.driverSetup} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}
