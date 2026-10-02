import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../authContext';
import { jsonResponse } from './helpers';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AuthModule = typeof import('../authContext');
type ApiModule = typeof import('../api');

const asha: User = {
  id: 'u1',
  name: 'Asha',
  email: 'asha@example.com',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
const ravi = { ...asha, id: 'u2', name: 'Ravi', role: 'employer' };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let auth: ReturnType<AuthModule['useAuth']>;
let modules: { auth: AuthModule; api: ApiModule };

async function load() {
  vi.resetModules();
  modules = { api: await import('../api'), auth: await import('../authContext') };
  return modules;
}

async function mount() {
  const { AuthProvider, useAuth } = modules.auth;
  function Probe() {
    auth = useAuth();
    return null;
  }
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  );
}

/** Resolves the pending fetch promises and lets React commit the results. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  root = createRoot(container);
  await load();
});

afterEach(() => {
  act(() => root.unmount());
});

describe('AuthProvider', () => {
  it('finishes loading signed out without calling the API when there is no token', async () => {
    await mount();
    await settle();
    expect(auth).toMatchObject({ user: null, loading: false, isAuthenticated: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores the signed-in user from /me', async () => {
    modules.api.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({ user: asha }));
    await mount();
    await settle();
    expect(auth).toMatchObject({ user: asha, loading: false, isAuthenticated: true });
  });

  it('ends the session when the account is rejected (403), but keeps it through outages', async () => {
    modules.api.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Account suspended' }, 403));
    await mount();
    await settle();
    expect(auth.user).toBeNull();
    expect(modules.api.hasAccessToken()).toBe(false);

    modules.api.setAccessToken('tok2');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'down' }, 500));
    await act(() => auth.refresh());
    expect(auth.user).toBeNull();
    expect(modules.api.hasAccessToken()).toBe(true);
  });

  it('signs in with a password, a code or a new account and stores the token', async () => {
    await mount();
    await settle();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha, accessToken: 'pw-token' }));
    await act(async () => {
      await expect(auth.login('asha@example.com', 'pw')).resolves.toEqual(asha);
    });
    expect(auth.user).toEqual(asha);
    expect(localStorage.getItem('musilynk_access_token')).toBe('pw-token');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'code-token' }));
    await act(async () => {
      await auth.verifyCode('ravi@example.com', '123456');
    });
    expect(auth.user).toEqual(ravi);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/otp/verify');
    expect(localStorage.getItem('musilynk_access_token')).toBe('code-token');

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha, accessToken: 'new-token' }));
    await act(async () => {
      await auth.register({ name: 'Asha', email: 'asha@example.com', password: 'longpassword', role: 'jobseeker' });
    });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/register');
    expect(localStorage.getItem('musilynk_access_token')).toBe('new-token');
  });

  it('signs out locally even if the logout request fails', async () => {
    modules.api.setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha }));
    await mount();
    await settle();

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await act(async () => {
      await auth.logout().catch(() => undefined);
    });
    expect(auth.user).toBeNull();
    expect(modules.api.hasAccessToken()).toBe(false);
  });

  it('remembers the signed-in role (not the token) for an expired-session redirect, and forgets it on sign-out', async () => {
    const roleKey = 'musilynk_session_role';
    await mount();
    await settle();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'hirer-token' }));
    await act(async () => {
      await auth.login('ravi@example.com', 'pw');
    });
    expect(localStorage.getItem(roleKey)).toBe('employer');
    expect(localStorage.getItem(roleKey)).not.toContain('hirer-token');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await act(async () => {
      await auth.logout();
    });
    expect(localStorage.getItem(roleKey)).toBeNull();

    // Other sign-in routes remember it too.
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'code-token' }));
    await act(async () => {
      await auth.verifyCode('ravi@example.com', '123456');
    });
    expect(localStorage.getItem(roleKey)).toBe('employer');
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha, accessToken: 'new-token' }));
    await act(async () => {
      await auth.register({ name: 'Asha', email: 'asha@example.com', password: 'longpassword', role: 'jobseeker' });
    });
    expect(localStorage.getItem(roleKey)).toBe('jobseeker');
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'second-factor-token' }));
    await act(async () => {
      await auth.completeSecondFactor('challenge', '123456');
    });
    expect(localStorage.getItem(roleKey)).toBe('employer');
  });

  it('keeps the remembered role through a failed /me, so a cold load that expires still signs in as the same role', async () => {
    localStorage.setItem('musilynk_session_role', 'employer');
    modules.api.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'down' }, 500));
    await mount();
    await settle();
    expect(auth.user).toBeNull();
    expect(localStorage.getItem('musilynk_session_role')).toBe('employer');
  });

  it('drops the remembered role when another tab signs out', async () => {
    await mount();
    await settle();
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'hirer-token' }));
    await act(async () => {
      await auth.login('ravi@example.com', 'pw');
    });
    localStorage.removeItem('musilynk_access_token');
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'musilynk_access_token', newValue: null, storageArea: localStorage }),
      );
    });
    expect(localStorage.getItem('musilynk_session_role')).toBeNull();
  });

  it('never lets a slow, older /me response overwrite a newer sign-in', async () => {
    modules.api.setAccessToken('old');
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );
    await mount();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'new' }));
    await act(async () => {
      await auth.login('ravi@example.com', 'pw');
    });
    resolveMe(jsonResponse({ user: asha }));
    await settle();

    expect(auth.user).toEqual(ravi);
  });

  it('ignores a stale /me failure after a newer sign-in', async () => {
    modules.api.setAccessToken('old');
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );
    await mount();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'new' }));
    await act(async () => {
      await auth.login('ravi@example.com', 'pw');
    });
    resolveMe(jsonResponse({ error: 'gone' }, 403));
    await settle();

    expect(auth.user).toEqual(ravi);
    expect(modules.api.hasAccessToken()).toBe(true);
  });

  it('follows sign-in and sign-out in another tab', async () => {
    await mount();
    await settle();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha }));
    localStorage.setItem('musilynk_access_token', 'other-tab');
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'musilynk_access_token', newValue: 'other-tab', storageArea: localStorage }),
      );
    });
    await settle();
    expect(auth.user).toEqual(asha);

    localStorage.removeItem('musilynk_access_token');
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'musilynk_access_token', newValue: null, storageArea: localStorage }),
      );
    });
    expect(auth).toMatchObject({ user: null, loading: false });
  });

  it('trades the one-time code from a Google redirect for a session and cleans the URL', async () => {
    const original = window.location.href;
    window.history.replaceState({}, '', '/jobseeker?auth=google&code=abc123&foo=bar');
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'google-tok', user: asha }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha }));
      await mount();
      await settle();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/exchange');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'abc123' });
      expect(auth).toMatchObject({ user: asha, isAuthenticated: true });
      expect(window.location.search).toBe('?foo=bar');
    } finally {
      window.history.replaceState({}, '', original);
    }
  });

  it('stays signed out when the exchange code is invalid or expired', async () => {
    const original = window.location.href;
    window.history.replaceState({}, '', '/jobseeker?auth=google&code=stale');
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'expired' }, 401));
      await mount();
      await settle();
      expect(modules.api.hasAccessToken()).toBe(false);
      expect(auth.user).toBeNull();
      expect(window.location.search).toBe('');
    } finally {
      window.history.replaceState({}, '', original);
    }
  });

  it('ignores code and token query params without auth=google', async () => {
    const original = window.location.href;
    window.history.replaceState({}, '', '/jobseeker?code=x&token=y');
    try {
      await mount();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(modules.api.hasAccessToken()).toBe(false);
    } finally {
      window.history.replaceState({}, '', original);
    }
  });

  it('exposes setUser for profile edits', async () => {
    await mount();
    await settle();
    act(() => auth.setUser(asha));
    expect(auth.isAuthenticated).toBe(true);
  });
});

describe('useAuth', () => {
  it('throws outside the provider', () => {
    const { useAuth } = modules.auth;
    function Orphan() {
      useAuth();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handled = (event: Event) => event.preventDefault();
    window.addEventListener('error', handled);
    try {
      expect(() => act(() => root.render(<Orphan />))).toThrow('useAuth must be used within AuthProvider');
    } finally {
      window.removeEventListener('error', handled);
      spy.mockRestore();
    }
  });
});
