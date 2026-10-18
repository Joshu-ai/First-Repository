// Client route paths (docs/SPEC.md "Client routes"). Build links with these instead of string literals.
import type { DriverClass, DriverProfile, Role, User } from '../../../shared/types';

export const paths = {
  home: '/',
  login: (next?: string | null) => (next ? `/login?next=${encodeURIComponent(next)}` : '/login'),
  signup: (role?: Role, driverClass?: DriverClass) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (role === 'driver' && driverClass) params.set('class', driverClass);
    const qs = params.toString();
    return qs ? `/signup?${qs}` : '/signup';
  },

  driverSetup: '/driver/setup',
  driverLoads: '/driver/loads',
  driverLoad: (loadId: string) => `/driver/loads/${encodeURIComponent(loadId)}`,
  driverTrips: '/driver/trips',
  driverAlerts: '/driver/alerts',
  driverProfile: '/driver/profile',

  shipperHome: '/shipper',
  shipperNewLoad: '/shipper/loads/new',
  /** Post a new load prefilled from an existing one. */
  shipperRepost: (loadId: string) => `/shipper/loads/new?from=${encodeURIComponent(loadId)}`,
  shipperLoad: (loadId: string) => `/shipper/loads/${encodeURIComponent(loadId)}`,
  shipperEditLoad: (loadId: string) => `/shipper/loads/${encodeURIComponent(loadId)}/edit`,

  messages: '/messages',
  thread: (loadId: string, driverId: string) => `/messages/${encodeURIComponent(loadId)}/${encodeURIComponent(driverId)}`,
  notifications: '/notifications',
  account: '/account',
} as const;

/** The load detail route for whoever is looking at it. */
export function loadPathFor(role: Role, loadId: string): string {
  return role === 'shipper' ? paths.shipperLoad(loadId) : paths.driverLoad(loadId);
}

/** Where a user lands after signing in (drivers with an unfinished rig profile go to setup). */
export function homePathFor(user: Pick<User, 'role'>, driverProfile: Pick<DriverProfile, 'profileComplete'> | null): string {
  if (user.role === 'shipper') return paths.shipperHome;
  return driverProfile?.profileComplete ? paths.driverLoads : paths.driverSetup;
}

/** Paths a driver may open before finishing setup. */
export function allowedBeforeSetup(pathname: string): boolean {
  return (
    pathname === paths.driverSetup ||
    pathname === paths.account ||
    pathname === paths.notifications ||
    pathname === paths.messages ||
    pathname.startsWith(`${paths.messages}/`)
  );
}

/**
 * Validates a ?next= value so sign-in can only redirect inside this app
 * (a same-origin path, never "//evil.example" or "https://...").
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/login') || next.startsWith('/signup')) return null;
  return next;
}
