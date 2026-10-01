import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from './helpers';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

async function loadApi() {
  vi.resetModules();
  const [api, download] = await Promise.all([import('../api'), import('../download')]);
  return { ...api, ...download };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: url as string, init: init as RequestInit & { headers: Headers } };
}

describe('apiDownload()', () => {
  it('fetches a file with the bearer token', async () => {
    const { apiDownload, setAccessToken } = await loadApi();
    setAccessToken('tok-dl');
    fetchMock.mockResolvedValue(new Response('code,kind\n', { status: 200, headers: { 'content-type': 'text/csv' } }));

    const blob = await apiDownload('/admin/promo-codes/export.csv');

    expect(await blob.text()).toBe('code,kind\n');
    const { url, init } = lastRequest();
    expect(url).toBe('/api/admin/promo-codes/export.csv');
    expect(init.headers.get('Authorization')).toBe('Bearer tok-dl');
  });

  it('sends no token when signed out and turns an error body into an ApiError', async () => {
    const { apiDownload } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Admin only', code: 'FORBIDDEN' }, 403));

    await expect(apiDownload('/admin/promo-codes/export.csv')).rejects.toMatchObject({
      message: 'Admin only',
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(lastRequest().init.headers.has('Authorization')).toBe(false);
  });

  it('falls back to a generic message when the error has no JSON body', async () => {
    const { apiDownload } = await loadApi();
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));

    await expect(apiDownload('/x')).rejects.toMatchObject({
      message: 'Something went wrong. Try again in a moment.',
      status: 500,
    });
  });
});
