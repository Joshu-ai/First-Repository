import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DriverProfile, MeResponse, User } from '../../../shared/types';
import { api, ApiError, onUnauthorized, type RegisterInput } from './api';

export interface AuthContextValue {
  user: User | null;
  /** The signed-in driver's rig profile; null for shippers and signed-out visitors. */
  driverProfile: DriverProfile | null;
  /** True until the first /api/auth/me call settles. */
  loading: boolean;
  /**
   * True after logout() in this tab, so route guards send the person to the landing page
   * instead of to /login?next=... (which is for expired sessions).
   */
  signedOut: boolean;
  login: (email: string, password: string) => Promise<MeResponse>;
  register: (input: RegisterInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
  /** Re-read /api/auth/me (null when signed out). */
  refresh: () => Promise<MeResponse | null>;
  /** Store a profile returned by PUT /api/drivers/me/profile or PATCH /me/location. */
  setDriverProfile: (profile: DriverProfile) => void;
  /** Store a user returned by PATCH /api/auth/me. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const next = await api.auth.me();
      setMe(next);
      return next;
    } catch (err) {
      // 401 means signed out. Anything else (offline, server down) also leaves the
      // visitor signed out locally; the next successful call or reload fixes it.
      if (!(err instanceof ApiError) || err.status !== 401) console.warn('Could not load session', err);
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => onUnauthorized(() => setMe(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await api.auth.login({ email, password });
    setMe(next);
    setSignedOut(false);
    return next;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const next = await api.auth.register(input);
    setMe(next);
    setSignedOut(false);
    return next;
  }, []);

  const logout = useCallback(async () => {
    // Set first: a 401 from an already-expired session clears the user before `finally` runs.
    setSignedOut(true);
    try {
      await api.auth.logout();
    } finally {
      setMe(null);
    }
  }, []);

  const setDriverProfile = useCallback((profile: DriverProfile) => {
    setMe((prev) => (prev ? { ...prev, driverProfile: profile } : prev));
  }, []);

  const setUser = useCallback((user: User) => {
    setMe((prev) => (prev ? { ...prev, user } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me?.user ?? null,
      driverProfile: me?.driverProfile ?? null,
      loading,
      signedOut,
      login,
      register,
      logout,
      refresh,
      setDriverProfile,
      setUser,
    }),
    [me, loading, signedOut, login, register, logout, refresh, setDriverProfile, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For pages behind <RequireRole>: the user is guaranteed to be signed in. */
export function useSignedInUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useSignedInUser used outside a signed-in route');
  return user;
}
