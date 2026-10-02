import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage, jsonResponse } from './helpers';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = typeof import('../api');
type ActingAs = typeof import('../actingAs');
let api: Api;
let mod: ActingAs;
let fetchMock: ReturnType<typeof vi.fn>;

const identities = [
  { type: 'user', id: 'u1', name: 'Riya Keys', key: 'user:u1' },
  { type: 'organization', id: 'o1', name: 'Riya Studios', key: 'organization:o1' },
  { type: 'act', id: 'a1', name: 'The Monsoon Collective', key: 'act:a1' },
];

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  api = await import('../api');
  mod = await import('../actingAs');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

function headersOfLastCall() {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return (init as RequestInit & { headers: Headers }).headers;
}

describe('acting-as header (api.ts)', () => {
  it('sends X-MusiLynk-Act-As for a chosen Page and nothing for yourself', async () => {
    api.setAccessToken('tok');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await api.apiGet('/portfolios');
    expect(headersOfLastCall().has('X-MusiLynk-Act-As')).toBe(false);

    api.setActingAs('organization:o1');
    expect(localStorage.getItem('musilynk_act_as')).toBe('organization:o1');
    await api.apiGet('/portfolios');
    expect(headersOfLastCall().get('X-MusiLynk-Act-As')).toBe('organization:o1');

    api.setActingAs('user:u1');
    expect(api.getActingAs()).toBeNull();
  });

  it('keeps an explicit header, and sends none when signed out', async () => {
    api.setAccessToken('tok');
    api.setActingAs('act:a1');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await api.api('/x', { headers: { 'X-MusiLynk-Act-As': 'user:u1' } });
    expect(headersOfLastCall().get('X-MusiLynk-Act-As')).toBe('user:u1');
    localStorage.removeItem('musilynk_access_token');
    vi.resetModules();
    const fresh = await import('../api');
    localStorage.setItem('musilynk_act_as', 'act:a1');
    await fresh.apiGet('/public/x');
    expect(headersOfLastCall().has('X-MusiLynk-Act-As')).toBe(false);
  });

  it('announces changes once and forgets the choice on sign-in and sign-out', () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(api.ACTING_AS_EVENT, listener);
    api.setActingAs('act:a1');
    api.setActingAs('act:a1');
    api.setAccessToken(null);
    api.setActingAs('act:a1');
    api.setAccessToken('new-session');
    window.removeEventListener(api.ACTING_AS_EVENT, listener);
    expect(seen).toEqual(['act:a1', null, 'act:a1', null]);
    expect(api.getActingAs()).toBeNull();
  });

  it('falls back to yourself when the API refuses the Page', async () => {
    api.setAccessToken('tok');
    api.setActingAs('organization:gone');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no', code: 'ACT_AS_FORBIDDEN' }, 403));
    await expect(api.apiGet('/portfolios')).rejects.toMatchObject({ status: 403 });
    expect(api.getActingAs()).toBeNull();
  });

  it('works when storage is blocked', async () => {
    const restore = blockStorage('localStorage');
    try {
      vi.resetModules();
      const blocked = await import('../api');
      blocked.setActingAs('act:a1');
      expect(blocked.getActingAs()).toBe('act:a1');
    } finally {
      restore();
    }
  });
});

describe('identities', () => {
  it('loads once per person, and drops a remembered Page they no longer run', async () => {
    api.setAccessToken('tok');
    localStorage.setItem('musilynk_act_as', 'act:old');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ identities })));
    await expect(mod.loadIdentities('u1')).resolves.toHaveLength(3);
    await mod.loadIdentities('u1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.getActingAs()).toBeNull();
    await mod.loadIdentities('u2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    mod.resetIdentities();
    await mod.loadIdentities('u2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps a valid choice, treats a missing list as empty, and retries after a failure', async () => {
    api.setAccessToken('tok');
    api.setActingAs('act:a1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ identities }));
    await mod.loadIdentities('u1');
    expect(api.getActingAs()).toBe('act:a1');
    mod.resetIdentities();
    fetchMock.mockResolvedValueOnce(jsonResponse({ nothing: true }));
    await expect(mod.loadIdentities('u1')).resolves.toEqual([]);
    mod.resetIdentities();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 400));
    await expect(mod.loadIdentities('u1')).rejects.toBeTruthy();
    fetchMock.mockResolvedValueOnce(jsonResponse({ identities }));
    await expect(mod.loadIdentities('u1')).resolves.toHaveLength(3);
  });
});

describe('hooks', () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: ReturnType<ActingAs['useIdentities']> & { key: string | null };
  function Harness({ userId }: { userId?: string }) {
    seen = { ...mod.useIdentities(userId), key: mod.useActingAsKey() };
    return null;
  }
  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
  });

  it('follows switches here and in other tabs, and names the current identity', async () => {
    api.setAccessToken('tok');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ identities })));
    await act(async () => {
      root.render(<Harness userId="u1" />);
    });
    expect(seen.identities).toHaveLength(3);
    expect(seen.current?.type).toBe('user');
    expect(seen.actingAsPage).toBe(false);

    act(() => api.setActingAs('act:a1'));
    expect(seen.key).toBe('act:a1');
    expect(seen.current?.name).toBe('The Monsoon Collective');
    expect(seen.actingAsPage).toBe(true);

    localStorage.setItem('musilynk_act_as', 'organization:o1');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'musilynk_act_as' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(seen.current?.name).toBe('Riya Studios');
  });

  it('is empty when signed out or when loading fails', async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    expect(seen.identities).toEqual([]);
    expect(seen.current).toBeNull();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'x' }, 400));
    api.setAccessToken('tok');
    await act(async () => {
      root.render(<Harness userId="u9" />);
    });
    expect(seen.identities).toEqual([]);
  });
});
