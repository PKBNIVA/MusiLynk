import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});
vi.mock('../../../lib/authContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../../components/Navigation', () => ({ Navigation: () => <nav data-testid="workspace-nav" /> }));
vi.mock('../../../components/PublicNav', () => ({ PublicNav: () => <nav data-testid="public-nav" /> }));
import { apiGet } from '../../../lib/api';
import { useAuth } from '../../../lib/authContext';
import PublicProfile from '../PublicProfile';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const professional = {
  id: 'u1',
  name: 'Asha Kulkarni',
  role: 'jobseeker',
  headline: 'Playback singer',
  location: 'Mumbai',
  roles: ['Vocalist'],
  genres: ['Ghazal'],
  languages: ['Hindi', 'Urdu'],
  eventTypes: ['Wedding'],
  skills: [],
  credits: [],
  instruments: [],
  verified: true,
  sessionRate: 8000,
  dayRate: 20000,
  hourlyRate: null,
  reviewsCount: 4,
  reviewsAverage: 4.5,
  bookingsCount: 2,
  responseTimeMinutes: 30,
  demo: false,
  photoUrl: null,
};

function signedInAs(user: { id: string; role: string } | null) {
  vi.mocked(useAuth).mockReturnValue({ user, status: user ? 'signedIn' : 'signedOut' } as ReturnType<typeof useAuth>);
}

async function mount(props: { shell?: 'public' | 'workspace' } = {}) {
  vi.mocked(apiGet).mockResolvedValue({ professional, portfolio: [] });
  const router = createMemoryRouter([{ path: '/professionals/:id', element: <PublicProfile {...props} /> }], {
    initialEntries: ['/professionals/u1'],
  });
  await act(async () => root.render(<RouterProvider router={router} />));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('PublicProfile', () => {
  it('leads with the from price, reviews, bookings and reply time, and lists only the filled rates', async () => {
    signedInAs(null);
    await mount();
    const facts = container.querySelector('[data-testid="profile-facts"]')?.textContent ?? '';
    expect(facts).toContain('from ₹8,000');
    expect(facts).toContain('4.5 · 4 reviews');
    expect(facts).toContain('2 bookings');
    expect(facts).toContain('Replies in ~30 min');
    const rows = [...container.querySelectorAll('[data-testid="rates-table"] tr')].map((r) => r.textContent);
    expect(rows).toEqual(['Session₹8,000', 'Day₹20,000']);
    expect(container.textContent).toContain('Hindi · Urdu');
    expect(container.querySelector('[data-testid="public-nav"]')).toBeTruthy();
    expect(container.textContent).toContain('Sign in to hire or message');
  });

  it('carries the musician into the quote and shows the workspace shell to a signed-in hirer', async () => {
    signedInAs({ id: 'h1', role: 'employer' });
    await mount();
    expect(container.querySelector('[data-testid="workspace-nav"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="public-nav"]')).toBeNull();
    const quote = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Request a quote');
    expect(quote?.getAttribute('href')).toBe('/employer/book-talent?member=u1');
  });

  it('honours an explicit public shell even when signed in', async () => {
    signedInAs({ id: 'h1', role: 'employer' });
    await mount({ shell: 'public' });
    expect(container.querySelector('[data-testid="public-nav"]')).toBeTruthy();
  });

  it("offers Edit profile, not Message or Request a quote, on one's own profile", async () => {
    signedInAs({ id: 'u1', role: 'jobseeker' });
    await mount();
    const links = [...container.querySelectorAll('a')].map((a) => a.textContent);
    expect(links).toContain('Edit profile');
    expect(links).not.toContain('Request a quote');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Message')).toBe(false);
    expect(
      [...container.querySelectorAll('a')].find((a) => a.textContent === 'Edit profile')?.getAttribute('href'),
    ).toBe('/jobseeker/profile');
  });
});
