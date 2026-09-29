import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiGet, apiPost, hasAccessToken, onAccessTokenChange, setAccessToken } from './api';

/**
 * A full-page "Continue with Google" round trip lands back on whatever page the backend
 * chose (see GoogleAuthController), not necessarily AuthPage — so the session's bearer
 * token (carried as `?token=` since there is no cookie to carry it instead) is picked up
 * once here, for every route, rather than in any one page.
 */
function consumeGoogleRedirectToken() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (url.searchParams.get('auth') !== 'google' || !token) return;
    setAccessToken(token);
    // Dynamically imported so this module (loaded eagerly at the app root) never pulls the
    // analytics module into the entry chunk (see App.tsx's own dynamic import of it).
    void import('./analytics').then((m) => m.track('auth_google_success'));
    url.searchParams.delete('token');
    url.searchParams.delete('auth');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* non-browser, or a blocked history API; the token stays unset and sign-in shows the sign-in page */
  }
}
import type { StarterPayload } from './onboarding';
export type Role = 'jobseeker' | 'employer' | 'admin';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  profileComplete: boolean;
  headline?: string | null;
  location?: string | null;
  companyName?: string | null;
  verified?: boolean;
  skills?: string[];
  genres?: string[];
  credits?: string[];
  openTo?: string[];
  phoneE164?: string | null;
  whatsappConsentedAt?: string | null;
}
/* Admin password sign-in answers with this instead of a session; the code emailed to the admin completes it. */
export interface SecondFactorChallenge {
  secondFactorRequired: true;
  method: 'email_code';
  challengeToken: string;
  message: string;
  expiresIn: number;
  debugCode?: string;
}
export const isSecondFactorChallenge = (value: unknown): value is SecondFactorChallenge => {
  const candidate = value as Partial<SecondFactorChallenge> | null | undefined;
  return Boolean(candidate && candidate.secondFactorRequired === true && typeof candidate.challengeToken === 'string');
};
export interface RegisterPayload extends StarterPayload {
  name: string;
  email: string;
  password: string;
  role: 'jobseeker' | 'employer';
  /** The sign-up's "I agree to the Terms and Privacy Policy" box; recorded as consented_at. */
  consent?: boolean;
}
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User | SecondFactorChallenge>;
  completeSecondFactor: (challengeToken: string, code: string) => Promise<User>;
  register: (p: RegisterPayload) => Promise<User>;
  verifyCode: (email: string, code: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  /* Each session change bumps the generation so a slower, older /me response can never overwrite a newer sign-in or sign-out. */
  const generation = useRef(0);
  const refresh = async () => {
    const current = ++generation.current;
    if (!hasAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const d = await apiGet<{ user: User }>('/me');
      if (current === generation.current) setUser(d.user);
    } catch (e) {
      /* Only a rejected session (expired, revoked or inactive account) ends it; timeouts and outages keep the token so the user can retry. A 401 is cleared by api() itself, and only if no other tab has signed in since. */ if (
        current !== generation.current
      )
        return;
      if (e instanceof ApiError && e.status === 403) setAccessToken(null);
      setUser(null);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    consumeGoogleRedirectToken();
    refresh();
  }, []);
  /* Sign-in or sign-out in another tab updates this one; a cleared token drops to signed-out state and protected routes send the user to sign-in. */
  useEffect(
    () =>
      onAccessTokenChange((signedIn) => {
        if (signedIn) {
          void refresh();
          return;
        }
        generation.current += 1;
        setUser(null);
        setLoading(false);
      }),
    [],
  );
  const login = async (email: string, password: string) => {
    const d = await apiPost<{ user: User; accessToken: string } | SecondFactorChallenge>('/auth/login', {
      email,
      password,
    });
    if (isSecondFactorChallenge(d)) return d;
    generation.current += 1;
    setAccessToken(d.accessToken);
    setUser(d.user);
    setLoading(false);
    return d.user;
  };
  const register = async (payload: RegisterPayload) => {
    const d = await apiPost<{ user: User; accessToken: string }>('/auth/register', payload);
    generation.current += 1;
    setAccessToken(d.accessToken);
    setUser(d.user);
    setLoading(false);
    return d.user;
  };
  /* Email sign-in code: same response as /auth/login; creates the account when the code was requested as a sign-up. */ const verifyCode =
    async (email: string, code: string) => {
      const d = await apiPost<{ user: User; accessToken: string }>('/auth/otp/verify', { email, code });
      generation.current += 1;
      setAccessToken(d.accessToken);
      setUser(d.user);
      setLoading(false);
      return d.user;
    };
  const completeSecondFactor = async (challengeToken: string, code: string) => {
    const d = await apiPost<{ user: User; accessToken: string }>('/auth/second-factor', { challengeToken, code });
    generation.current += 1;
    setAccessToken(d.accessToken);
    setUser(d.user);
    setLoading(false);
    return d.user;
  };
  const logout = async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      generation.current += 1;
      setAccessToken(null);
      setUser(null);
    }
  };
  return (
    <AuthContext.Provider
      value={useMemo(
        () => ({
          user,
          loading,
          isAuthenticated: !!user,
          login,
          register,
          verifyCode,
          completeSecondFactor,
          logout,
          refresh,
          setUser,
        }),
        [user, loading],
      )}
    >
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
};
