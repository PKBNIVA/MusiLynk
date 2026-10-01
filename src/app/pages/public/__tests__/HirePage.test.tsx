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
import HirePage from '../HirePage';

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
  const router = createMemoryRouter([{ path: '/hire/:role/:city', element: <HirePage /> }], { initialEntries: [url] });
  await act(async () =>
    root.render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  );
  return router;
}

const HIRE_PAGE_DATA = {
  role: { slug: 'drummer', label: 'Drummer' },
  city: { slug: 'mumbai', name: 'Mumbai' },
  counts: { professionals: 8, verified: 3, availableThisWeek: 2 },
  featured: [
    {
      id: 'u1',
      name: 'Rahul',
      role: 'jobseeker',
      headline: 'Session drummer',
      location: 'Mumbai',
      verified: true,
      skills: [],
      genres: [],
      instruments: [],
      languages: [],
      credits: [],
      openTo: [],
      roles: [],
      gear: [],
      software: [],
    },
  ],
  relatedRoles: [{ slug: 'guitarist', label: 'Guitarist', count: 6 }],
  nearbyCities: [{ slug: 'pune', name: 'Pune' }],
  indexable: true,
  ratesPath: '/rates/mumbai',
  faq: [
    {
      question: 'How much does a session drummer in Mumbai charge?',
      answer: 'Rates vary by experience and event; ask for a quote through Verse.',
    },
    { question: 'Q2', answer: 'A2' },
    { question: 'Q3', answer: 'A3' },
    { question: 'Q4', answer: 'See /rates/mumbai for full ranges.' },
  ],
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

describe('HirePage', () => {
  it('renders stat tiles, the featured grid and the FAQ', async () => {
    vi.mocked(apiGet).mockResolvedValue(HIRE_PAGE_DATA);
    await mount('/hire/drummer/mumbai');
    await act(async () => {});

    expect(apiGet).toHaveBeenCalledWith('/public/hire-pages/drummer/mumbai', { skipAuthRedirect: true });
    expect(container.querySelector('[data-testid="hire-stats"]')?.textContent).toContain('8');
    expect(container.querySelector('[data-testid="featured-grid"]')?.textContent).toContain('Rahul');
    expect(container.textContent).toContain('How much does a session drummer in Mumbai charge?');
    expect(container.textContent).toContain('Hire a verified drummer in Mumbai');
  });

  it("names a person's city at most once on the card (the page heading already says it)", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      ...HIRE_PAGE_DATA,
      featured: [{ ...HIRE_PAGE_DATA.featured[0], headline: 'Session drummer · Mumbai', location: 'Mumbai' }],
    });
    await mount('/hire/drummer/mumbai');
    await act(async () => {});
    const card = container.querySelector('[data-testid="featured-grid"]')?.textContent ?? '';
    expect(card.match(/Mumbai/g)).toHaveLength(1);
    expect(container.querySelector('[data-testid="featured-grid"] svg.lucide-map-pin')).toBeNull();
  });

  it('prefills the urgent CTA with role and city', async () => {
    vi.mocked(apiGet).mockResolvedValue(HIRE_PAGE_DATA);
    await mount('/hire/drummer/mumbai');
    await act(async () => {});

    const cta = container.querySelector<HTMLAnchorElement>('[data-testid="urgent-cta"]');
    expect(cta?.getAttribute('href')).toBe('/urgent?role=Drummer&city=Mumbai');
  });

  it('sets noindex when the page is not indexable', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      ...HIRE_PAGE_DATA,
      indexable: false,
      counts: { professionals: 2, verified: 0, availableThisWeek: 0 },
    });
    await mount('/hire/drummer/goa');
    await act(async () => {});

    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
  });

  it('is noindex from the first render, until the API says the page qualifies', async () => {
    vi.mocked(apiGet).mockReturnValue(new Promise(() => {}));
    await mount('/hire/drummer/mumbai');
    expect(container.textContent).toContain('Loading');
    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
  });

  it('emits a BreadcrumbList with absolute URLs', async () => {
    vi.mocked(apiGet).mockResolvedValue(HIRE_PAGE_DATA);
    await mount('/hire/drummer/mumbai');
    await act(async () => {});
    expect(breadcrumbItems()).toEqual([
      `${window.location.origin}/`,
      `${window.location.origin}/music-professionals`,
      `${window.location.origin}/hire/drummer/mumbai`,
    ]);
  });

  it('stays indexable when the page qualifies', async () => {
    vi.mocked(apiGet).mockResolvedValue(HIRE_PAGE_DATA);
    await mount('/hire/drummer/mumbai');
    await act(async () => {});
    expect(container.textContent).toContain('Hire a verified drummer in Mumbai');
    expect(meta('name', 'robots')?.content ?? '').not.toContain('noindex');
  });

  it('shows the role photograph, and art rather than a face for demo people', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      ...HIRE_PAGE_DATA,
      featured: [{ ...HIRE_PAGE_DATA.featured[0], demo: true, sessionRate: 9000 }],
    });
    await mount('/hire/drummer/mumbai');
    await act(async () => {});
    const header = container.querySelector('[data-testid="photo-header"] img');
    expect(header?.getAttribute('src')).toBe('/img/drummer-stage-1600.webp');
    const card = container.querySelector('[data-testid="featured-grid"] a');
    expect(card?.textContent).toContain('from ₹9,000');
    expect(card?.querySelector('img')).toBeNull();
  });

  it('shows a not-found message when the API 404s', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('Not found'));
    await mount('/hire/nope/nowhere');
    await act(async () => {});

    expect(container.textContent).toContain('Not found');
    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
  });
});
