import { publicOrigin } from '../../../lib/siteMeta';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn() };
});
import { apiGet } from '../../../lib/api';
import { AuthProvider } from '../../../lib/authContext';
import RatesPage from '../RatesPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function meta(attr: 'name' | 'property', key: string) {
  return document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
}

function breadcrumbItems() {
  const raw = document.querySelector('script[type="application/ld+json"][data-page-meta]')?.textContent ?? '[]';
  const graph = JSON.parse(raw) as Array<{ '@type': string; itemListElement?: { item: string }[] }>;
  return graph.find((entry) => entry['@type'] === 'BreadcrumbList')?.itemListElement?.map((entry) => entry.item);
}

async function mount(url: string) {
  const router = createMemoryRouter([{ path: '/rates/:city', element: <RatesPage /> }], { initialEntries: [url] });
  await act(async () =>
    root.render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  );
  return router;
}

const RATES_DATA = {
  city: { slug: 'mumbai', name: 'Mumbai' },
  roles: [
    {
      slug: 'drummer',
      label: 'Drummer',
      n: 8,
      hasData: true,
      sessionRate: { median: 4000, p25: 3000, p75: 5000, n: 8 },
      showRate: null,
      dayRate: null,
    },
    { slug: 'guitarist', label: 'Guitarist', n: 2, hasData: false, sessionRate: null, showRate: null, dayRate: null },
  ],
  indexable: true,
  updatedAt: '2026-09-01T00:00:00Z',
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  document.head.querySelectorAll('meta,link[rel="canonical"],script[data-page-meta]').forEach((el) => el.remove());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiGet).mockReset();
});

describe('RatesPage', () => {
  it('renders the rates table with ranges and sample sizes', async () => {
    vi.mocked(apiGet).mockResolvedValue(RATES_DATA);
    await mount('/rates/mumbai');
    await act(async () => {});

    expect(apiGet).toHaveBeenCalledWith('/public/rates/mumbai', { skipAuthRedirect: true });
    const table = container.querySelector('[data-testid="rates-table"]');
    expect(table?.textContent).toContain('Drummer');
    expect(table?.textContent).toContain('8 profiles');
    expect(table?.textContent).toContain('Not enough data yet');
  });

  it('sets noindex when fewer than three roles have data', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...RATES_DATA, indexable: false });
    await mount('/rates/goa');
    await act(async () => {});

    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
  });

  it('is noindex from the first render, until the API says there is enough data', async () => {
    vi.mocked(apiGet).mockReturnValue(new Promise(() => {}));
    await mount('/rates/mumbai');
    expect(container.textContent).toContain('Loading');
    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
  });

  it('emits a BreadcrumbList with absolute URLs', async () => {
    vi.mocked(apiGet).mockResolvedValue(RATES_DATA);
    await mount('/rates/mumbai');
    await act(async () => {});
    expect(breadcrumbItems()).toEqual([
      `${publicOrigin()}/`,
      `${publicOrigin()}/music-professionals`,
      `${publicOrigin()}/rates/mumbai`,
    ]);
  });

  it('is not noindex when there is enough data, and has a photo header', async () => {
    vi.mocked(apiGet).mockResolvedValue(RATES_DATA);
    await mount('/rates/mumbai');
    await act(async () => {});
    expect(meta('name', 'robots')?.content ?? '').not.toContain('noindex');
    expect(container.querySelector('[data-testid="photo-header"]')).not.toBeNull();
  });
});
