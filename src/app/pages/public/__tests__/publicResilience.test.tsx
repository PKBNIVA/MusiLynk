import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});
import { apiGet } from '../../../lib/api';
import { AuthProvider } from '../../../lib/authContext';
import LegalPage from '../LegalPage';
import PublicAct from '../PublicAct';
import PublicActs from '../PublicActs';
import PublicJobs from '../PublicJobs';
import PublicOpportunity from '../PublicOpportunity';
import PublicProfile from '../PublicProfile';
import PublicTalent from '../PublicTalent';

// These used to be regex assertions over the page source (tests/frontend-resilience-smoke.mjs). They
// now render the real pages against a failing or empty API, so they keep passing when the markup moves.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const get = vi.mocked(apiGet);

async function mount(pattern: string, url: string, element: React.ReactElement) {
  const router = createMemoryRouter([{ path: pattern, element }], { initialEntries: [url] });
  await act(async () =>
    root.render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  );
  document.body.append(container);
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === name);
const hrefs = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  get.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('public detail pages', () => {
  const pages = [
    { name: 'opportunity', pattern: '/opportunities/:id', url: '/opportunities/j1', page: <PublicOpportunity /> },
    { name: 'profile', pattern: '/professionals/:id', url: '/professionals/p1', page: <PublicProfile /> },
    { name: 'act', pattern: '/acts/:id', url: '/acts/a1', page: <PublicAct /> },
  ];

  for (const { name, pattern, url, page } of pages) {
    it(`the ${name} page shows a failed request and retries it`, async () => {
      get.mockRejectedValueOnce(new Error('The server is having a moment.'));
      // The retry answers with no record, which these pages show as "not available".
      get.mockResolvedValueOnce({});
      await mount(pattern, url, page);
      await settle();

      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('The server is having a moment.');
      expect(get).toHaveBeenCalledTimes(1);

      await act(async () => buttonNamed('Try again')!.click());
      await settle();
      expect(get).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain(`This ${name} isn’t available`);
    });
  }

  it('shows a loading state before the request answers', async () => {
    get.mockReturnValue(new Promise(() => {}));
    await mount('/acts/:id', '/acts/a1', <PublicAct />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading act');
  });
});

describe('public catalogs', () => {
  const catalogs = [
    {
      name: 'jobs',
      url: '/music-jobs',
      page: <PublicJobs />,
      loading: 'Loading opportunities',
      guest: /^\/(auth|join)\//,
    },
    {
      name: 'professionals',
      url: '/music-professionals',
      page: <PublicTalent />,
      loading: 'Loading musicians',
      guest: /^\/(auth|join)\//,
    },
    { name: 'acts', url: '/book-music', page: <PublicActs />, loading: 'Loading acts', guest: /^\/(auth|join)\// },
  ];

  for (const { name, url, page, loading, guest } of catalogs) {
    it(`the ${name} catalog shows a failed request and retries it`, async () => {
      // The directory pages also read the taxonomy for their filter chips; only the list is under test.
      const listCalls = () => get.mock.calls.filter(([path]) => !String(path).startsWith('/taxonomy')).length;
      get.mockImplementation((path) =>
        String(path).startsWith('/taxonomy')
          ? Promise.reject(new Error('no taxonomy'))
          : listCalls() > 1
            ? new Promise(() => {})
            : Promise.reject(new Error('Could not reach the server.')),
      );
      await mount(url, url, page);
      await settle();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not reach the server.');
      expect(container.querySelector('[data-testid="result-count"]')).toBeNull();

      await act(async () => buttonNamed('Try again')!.click());
      expect(listCalls()).toBe(2);
      expect(container.querySelector('[role="status"]')?.textContent).toContain(loading);
    });

    it(`an empty ${name} catalog offers a way in instead of a dead end`, async () => {
      get.mockResolvedValue({ jobs: [], talent: [], acts: [], total: 0, nextCursor: null });
      await mount(url, url, page);
      await settle();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(buttonNamed('Try again')).toBeUndefined();
      expect(hrefs().some((href) => guest.test(href))).toBe(true);
    });
  }

  it('tells an empty act catalog apart from a failed request', async () => {
    get.mockResolvedValue({ acts: [], total: 0, nextCursor: null });
    await mount('/book-music', '/book-music', <PublicActs />);
    await settle();
    expect(container.textContent).toContain('No bookable acts are listed yet.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('legal and information pages', () => {
  // Internal launch instructions must never reach a visitor.
  const internal =
    /starter terms|replace this placeholder|operational starter copy|production launch should|production operations should/i;
  const paths = [
    'about',
    'terms',
    'privacy',
    'safety',
    'cookies',
    'refund-policy',
    'community-guidelines',
    'accessibility',
    'contact',
  ];

  async function open(path: string) {
    get.mockRejectedValue(new Error('policy unavailable'));
    await mount('/:page', `/${path}`, <LegalPage />);
    await settle();
  }

  for (const path of paths) {
    it(`/${path} renders without internal launch instructions`, async () => {
      await open(path);
      expect(container.querySelector('h1')?.textContent?.length).toBeGreaterThan(0);
      expect(container.textContent).not.toMatch(internal);
    });
  }

  it('the browser storage notice describes the storage model that is actually implemented', async () => {
    await open('cookies');
    expect(container.querySelector('h1')?.textContent).toBe('Browser Storage & Session Notice');
    expect(container.textContent).toContain('local storage');
    expect(container.textContent).not.toContain('HttpOnly cookie');
  });

  it('the contact page gives an actionable support link', async () => {
    await open('contact');
    expect(hrefs().some((href) => href.startsWith('mailto:'))).toBe(true);
  });

  it('still renders when the policy API fails', async () => {
    await open('privacy');
    expect(container.textContent).not.toContain('Grievance Officer');
    expect(container.querySelector('h1')?.textContent).toBe('Privacy Policy');
  });
});
