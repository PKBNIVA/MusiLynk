import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from './helpers';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type AuthModule = typeof import('../authContext');
type ApiModule = typeof import('../api');

const asha = { id: 'u1', name: 'Asha', email: 'asha@example.com', role: 'jobseeker', status: 'active', profileComplete: true };
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
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
}

/** Resolves the pending fetch promises and lets React commit the results. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

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
    await act(async () => { await expect(auth.login('asha@example.com', 'pw')).resolves.toEqual(asha); });
    expect(auth.user).toEqual(asha);
    expect(localStorage.getItem('verse_access_token')).toBe('pw-token');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'code-token' }));
    await act(async () => { await auth.verifyCode('ravi@example.com', '123456'); });
    expect(auth.user).toEqual(ravi);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/otp/verify');
    expect(localStorage.getItem('verse_access_token')).toBe('code-token');

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha, accessToken: 'new-token' }));
    await act(async () => { await auth.register({ name: 'Asha', email: 'asha@example.com', password: 'longpassword', role: 'jobseeker' }); });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/register');
    expect(localStorage.getItem('verse_access_token')).toBe('new-token');
  });

  it('signs out locally even if the logout request fails', async () => {
    modules.api.setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha }));
    await mount();
    await settle();

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await act(async () => { await auth.logout().catch(() => undefined); });
    expect(auth.user).toBeNull();
    expect(modules.api.hasAccessToken()).toBe(false);
  });

  it('never lets a slow, older /me response overwrite a newer sign-in', async () => {
    modules.api.setAccessToken('old');
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveMe = resolve; }));
    await mount();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'new' }));
    await act(async () => { await auth.login('ravi@example.com', 'pw'); });
    resolveMe(jsonResponse({ user: asha }));
    await settle();

    expect(auth.user).toEqual(ravi);
  });

  it('ignores a stale /me failure after a newer sign-in', async () => {
    modules.api.setAccessToken('old');
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveMe = resolve; }));
    await mount();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: ravi, accessToken: 'new' }));
    await act(async () => { await auth.login('ravi@example.com', 'pw'); });
    resolveMe(jsonResponse({ error: 'gone' }, 403));
    await settle();

    expect(auth.user).toEqual(ravi);
    expect(modules.api.hasAccessToken()).toBe(true);
  });

  it('follows sign-in and sign-out in another tab', async () => {
    await mount();
    await settle();

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: asha }));
    localStorage.setItem('verse_access_token', 'other-tab');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'verse_access_token', newValue: 'other-tab', storageArea: localStorage }));
    });
    await settle();
    expect(auth.user).toEqual(asha);

    localStorage.removeItem('verse_access_token');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'verse_access_token', newValue: null, storageArea: localStorage }));
    });
    expect(auth).toMatchObject({ user: null, loading: false });
  });

  it('exposes setUser for profile edits', async () => {
    await mount();
    await settle();
    act(() => auth.setUser(asha as any));
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
