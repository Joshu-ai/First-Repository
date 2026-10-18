import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import type { Role } from '../../../shared/types';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/cx';
import { useRealtime } from '../lib/realtime';
import { homePathFor, paths } from '../lib/routes';
import { CountBubble } from './Badge';
import { ButtonLink } from './Button';
import { Avatar } from './DataDisplay';
import { PageLoader } from './Feedback';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  isActive: (pathname: string) => boolean;
}

const startsWith = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

const DRIVER_NAV: NavItem[] = [
  { to: paths.driverLoads, label: 'Loads', icon: 'boxes', isActive: startsWith(paths.driverLoads) },
  { to: paths.driverTrips, label: 'Trips', icon: 'route', isActive: startsWith(paths.driverTrips) },
  { to: paths.driverAlerts, label: 'Alerts', icon: 'siren', isActive: startsWith(paths.driverAlerts) },
  { to: paths.messages, label: 'Messages', icon: 'message', isActive: startsWith(paths.messages) },
  { to: paths.driverProfile, label: 'Profile', icon: 'user', isActive: startsWith(paths.driverProfile) },
];

const SHIPPER_NAV: NavItem[] = [
  {
    to: paths.shipperHome,
    label: 'Dashboard',
    icon: 'grid',
    isActive: (p) => startsWith(paths.shipperHome)(p) && !p.startsWith(paths.shipperNewLoad),
  },
  { to: paths.shipperNewLoad, label: 'Post load', icon: 'plusSquare', isActive: startsWith(paths.shipperNewLoad) },
  { to: paths.messages, label: 'Messages', icon: 'message', isActive: startsWith(paths.messages) },
  { to: paths.account, label: 'Account', icon: 'user', isActive: startsWith(paths.account) },
];

export function navItemsFor(role: Role): NavItem[] {
  return role === 'driver' ? DRIVER_NAV : SHIPPER_NAV;
}

function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      Skip to content
    </a>
  );
}

/**
 * Layout for signed-in pages: navy top bar (logo, role nav from 1024px up, notifications bell,
 * account menu) and a bottom tab bar on phones and tablets. Renders the matched route in <main>.
 * Drivers who have not finished setup get a minimal bar without the tabs.
 */
export function AppShell() {
  const { user, driverProfile } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so screen readers announce the new page.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  if (!user) return null;
  const settingUp = user.role === 'driver' && !driverProfile?.profileComplete;
  const nav = settingUp ? [] : navItemsFor(user.role);
  // The shipper tab bar already has Account; drivers reach it from the menu.
  const desktopNav = user.role === 'shipper' ? nav.filter((n) => n.to !== paths.account) : nav;

  return (
    <div className={cx('app', nav.length > 0 && 'app--tabbed')}>
      <SkipLink />
      <header className="topbar">
        <div className="topbar__inner container">
          <Link to={homePathFor(user, driverProfile)} className="topbar__logo" aria-label="HaulMatch home">
            <Logo inverse />
          </Link>
          {desktopNav.length ? (
            <nav className="topbar__nav" aria-label="Main">
              {desktopNav.map((item) => {
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cx('topbar__link', active && 'is-active')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <span className="topbar__spacer" />
          )}
          <div className="topbar__tools">
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="app__main">
        <div className="container page">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {nav.length ? <TabBar items={nav} pathname={pathname} /> : null}
    </div>
  );
}

function NotificationBell() {
  const { unreadCount } = useRealtime();
  const { pathname } = useLocation();
  const active = pathname === paths.notifications;
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications';
  return (
    <Link
      to={paths.notifications}
      className={cx('icon-button', 'topbar__bell', active && 'is-active')}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name="bell" size={22} />
      <CountBubble count={unreadCount} className="topbar__badge" />
    </Link>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  // Once the user is cleared, RequireRole sends the page to "/" (see AuthContextValue.signedOut).
  const signOut = () => {
    setSigningOut(true);
    // logout() signs out locally even when the request fails (no signal), so there is nothing to report.
    logout().catch(() => undefined);
  };

  return (
    <div className="account-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account-menu__button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} size="sm" />
        <span className="account-menu__name hide-mobile">{user.name.split(' ')[0]}</span>
        <Icon name="chevronDown" size={16} className="hide-mobile" />
        <span className="visually-hidden">Account menu</span>
      </button>
      <div id={menuId} className="account-menu__panel" hidden={!open}>
        <div className="account-menu__who">
          <p className="account-menu__full">{user.name}</p>
          <p className="account-menu__email">{user.email}</p>
          {user.company ? <p className="account-menu__email">{user.company}</p> : null}
        </div>
        <ul className="account-menu__list">
          {user.role === 'driver' ? (
            <MenuLink to={paths.driverProfile} icon="truck">
              Rig &amp; preferences
            </MenuLink>
          ) : null}
          <MenuLink to={paths.account} icon="user">
            Account settings
          </MenuLink>
          <MenuLink to={paths.notifications} icon="bell">
            Notifications
          </MenuLink>
          <li>
            <button type="button" className="account-menu__item" onClick={signOut} disabled={signingOut}>
              <Icon name="logout" size={18} />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: IconName; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className="account-menu__item">
        <Icon name={icon} size={18} />
        {children}
      </Link>
    </li>
  );
}

function TabBar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cx('tabbar__item', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size={24} />
            <span className="tabbar__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Layout for signed-out pages (landing, login, signup): light header with sign-in links and a footer. */
export function PublicShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="app app--public">
      <SkipLink />
      <header className="topbar public-header">
        <div className="topbar__inner container">
          <Link to={paths.home} className="topbar__logo" aria-label="HaulMatch home">
            <Logo inverse />
          </Link>
          <nav className="public-header__nav" aria-label="Account">
            {pathname !== '/login' ? (
              <Link to={paths.login()} className="topbar__link">
                Log in
              </Link>
            ) : null}
            {pathname !== '/signup' ? (
              <ButtonLink to={paths.signup()} size="sm">
                Sign up<span className="hide-narrow"> free</span>
              </ButtonLink>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="app__main">
        <Suspense fallback={<PageLoader />}>{children ?? <Outlet />}</Suspense>
      </main>
      <footer className="public-footer">
        <div className="container public-footer__inner">
          <Logo />
          <p className="muted">Loads that fit your rig. Built for hotshot and semi drivers and the shippers who need them.</p>
          <p className="muted text-sm">Rates and benchmarks shown in HaulMatch are estimates, not live market data.</p>
        </div>
      </footer>
    </div>
  );
}
