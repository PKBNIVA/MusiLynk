import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Notification, Organization, OrganizationMember } from '../../lib/apiTypes';

// These used to be regex assertions over the page source (tests/frontend-resilience-smoke.mjs). They
// now render the real pages against a failing API and check what the visitor sees and what is sent.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: null as { id: string; role: string; name: string } | null }));
vi.mock('../../lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authContext')>()),
  useAuth: () => ({
    user: auth.user,
    status: auth.user ? 'signedIn' : 'signedOut',
    isAuthenticated: Boolean(auth.user),
  }),
}));
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../components/showcase/ApplyMaterials', () => ({ ApplyMaterials: () => null }));
vi.mock('../../components/ai/AiSuggestButton', () => ({ AiSuggestButton: () => null }));
vi.mock('../../components/stage/ShareToStageButton', () => ({ ShareToStageButton: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { apiDelete, apiGet, apiPatch } from '../../lib/api';
import AdminTester from '../AdminTester';
import Availability from '../Availability';
import JobDetails from '../JobDetails';
import Notifications from '../Notifications';
import Workspace from '../Workspace';

let container: HTMLDivElement;
let root: Root;
const get = vi.mocked(apiGet);
const patch = vi.mocked(apiPatch);
const del = vi.mocked(apiDelete);

async function mount(pattern: string, url: string, element: React.ReactElement) {
  const router = createMemoryRouter([{ path: pattern, element }], { initialEntries: [url] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const byText = (selector: string, text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === text);
const click = (el: HTMLElement | undefined) => act(async () => el!.click());

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  get.mockReset();
  patch.mockReset();
  del.mockReset();
  auth.user = { id: 'u1', role: 'jobseeker', name: 'Asha' };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Notifications', () => {
  const note = (id: string): Notification => ({
    id,
    title: `Update ${id}`,
    body: 'Something happened.',
    createdAt: '2026-09-01T10:00:00Z',
    readAt: null,
  });
  const serve = (notifications: Notification[]) =>
    get.mockImplementation(async (path) => {
      if (path === '/notifications') return { notifications };
      if (path === '/notifications/preferences') return { emailNotifications: true };
      throw new Error(`unexpected GET ${path}`);
    });

  it('says when the list cannot be loaded and offers a retry', async () => {
    get.mockRejectedValue(new Error(''));
    await mount('/notifications', '/notifications', <Notifications />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load notifications.');
    expect(byText('button', 'Try again')).toBeDefined();
  });

  it('marks a notification read at once and puts it back if the request fails', async () => {
    serve([note('n1')]);
    let fail!: (error: Error) => void;
    patch.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await mount('/notifications', '/notifications', <Notifications />);
    await settle();
    const card = () => container.querySelector('[data-testid="notification"]')!;
    expect(card().getAttribute('data-read')).toBe('false');

    await click(byText('button', 'Mark as read'));
    expect(card().getAttribute('data-read')).toBe('true');
    expect(patch).toHaveBeenCalledWith('/notifications/n1', {});

    await act(async () => fail(new Error('')));
    expect(card().getAttribute('data-read')).toBe('false');
    expect(toast.error).toHaveBeenCalledWith('Unable to mark notification as read. Try again.');
  });

  it('loads older notifications with the keyset cursor and shows each one once', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/notifications') return { notifications: [note('n3'), note('n2')], nextCursor: 'c1' };
      if (path === '/notifications?cursor=c1') return { notifications: [note('n2'), note('n1')], nextCursor: null };
      if (path === '/notifications/preferences') return { emailNotifications: true };
      throw new Error(`unexpected GET ${path}`);
    });
    await mount('/notifications', '/notifications', <Notifications />);
    await settle();
    const ids = () => [...container.querySelectorAll('[data-testid="notification"]')].map((el) => el.textContent);
    expect(ids()).toHaveLength(2);

    await click(container.querySelector<HTMLElement>('[data-testid="notifications-load-more"]')!);
    await settle();
    expect(ids()).toHaveLength(3);
    expect(get).toHaveBeenCalledWith('/notifications?cursor=c1');
    expect(container.querySelector('[data-testid="notifications-load-more"]')).toBeNull();
  });

  it('offers no "load older" button when the first page is the whole list', async () => {
    serve([note('n1')]);
    await mount('/notifications', '/notifications', <Notifications />);
    await settle();
    expect(container.querySelector('[data-testid="notifications-load-more"]')).toBeNull();
  });
});

describe('Job details', () => {
  const job = (): Job => ({
    id: 'j1',
    employer_id: 'e1',
    title: 'Session guitarist',
    company: 'Bandra Tape Studio',
    location: 'Mumbai',
    kind: 'session',
    type: 'session',
    status: 'active',
    skills: [],
    languages: [],
    screening_questions: [],
    screeningQuestions: [],
    portfolioRequired: false,
    employerName: 'Bandra Tape Studio',
    employerVerified: false,
    demo: false,
    applicationsCount: 0,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
  });

  it('shows Save and Report to musicians only', async () => {
    get.mockResolvedValue({ job: job() });
    for (const [role, expected] of [
      ['jobseeker', true],
      ['employer', false],
    ] as const) {
      auth.user = { id: 'u1', role, name: 'Asha' };
      await mount('/jobs/:id', '/jobs/j1', <JobDetails />);
      await settle();
      expect(container.textContent).toContain('Session guitarist');
      expect(Boolean(byText('button', 'Save'))).toBe(expected);
      expect(Boolean(container.querySelector('[aria-label="Report opportunity"]'))).toBe(expected);
      act(() => root.render(null));
    }
  });

  it('says so when the opportunity cannot be loaded', async () => {
    get.mockResolvedValue({});
    await mount('/jobs/:id', '/jobs/j1', <JobDetails />);
    await settle();
    expect(container.textContent).toContain('This opportunity is no longer available');
  });
});

describe('Availability', () => {
  beforeEach(() => {
    get.mockResolvedValue({ windows: [] });
  });

  it('checks the date range before calling the API', async () => {
    const post = (await import('../../lib/api')).apiPost;
    await mount('/availability', '/availability', <Availability />);
    await settle();
    await click(byText('button', 'Add'));
    expect(container.textContent).toContain('Choose a start time.');
    expect(container.textContent).toContain('Choose an end time.');
    expect(post).not.toHaveBeenCalled();
  });

  it('offers a retry when the windows cannot be loaded', async () => {
    get.mockRejectedValue(new Error(''));
    await mount('/availability', '/availability', <Availability />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load availability.');
    get.mockResolvedValue({ windows: [] });
    await click(byText('button', 'Try again'));
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No availability published yet.');
  });

  it('shows a window that could not be removed and keeps it listed', async () => {
    get.mockResolvedValue({
      windows: [{ id: 'w1', startAt: '2026-10-01T10:00:00Z', endAt: '2026-10-01T12:00:00Z', status: 'available' }],
    });
    del.mockRejectedValue(new Error(''));
    await mount('/availability', '/availability', <Availability />);
    await settle();
    await click(container.querySelector<HTMLElement>('[aria-label="Remove availability"]')!);
    // Removing now asks first; the failure shows inside the confirmation dialog.
    const confirm = [...document.body.querySelectorAll<HTMLElement>('[role="alertdialog"] button')].find(
      (b) => b.textContent === 'Remove availability',
    )!;
    await click(confirm);
    await settle();
    expect(document.body.textContent).toContain('Unable to remove availability.');
    expect(container.querySelector('[aria-label="Remove availability"]')).not.toBeNull();
  });
});

describe('Workspace', () => {
  const org: Organization = {
    id: 'o1',
    owner_id: 'u1',
    name: 'Bandra Tape Studio',
    status: 'active',
    memberCount: 2,
    memberRole: 'owner',
  };
  const members: OrganizationMember[] = [
    { id: 'u1', name: 'Asha', email: 'asha@example.test', role: 'owner' },
    { id: 'u2', name: 'Ravi', email: 'ravi@example.test', role: 'recruiter' },
  ];

  it('says when workspaces cannot be loaded', async () => {
    get.mockRejectedValue(new Error(''));
    await mount('/workspace', '/workspace', <Workspace />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load workspaces.');
  });

  it('asks before removing a member and only then deletes them', async () => {
    get.mockImplementation(async (path) => (path === '/organizations' ? { organizations: [org] } : { members }));
    del.mockResolvedValue({ ok: true });
    await mount('/workspace', '/workspace', <Workspace />);
    await settle();

    await click(container.querySelector<HTMLElement>('[aria-label="Remove Ravi"]')!);
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Remove Ravi?');
    expect(del).not.toHaveBeenCalled();

    await click(byText('button', 'Keep as is', dialog));
    expect(del).not.toHaveBeenCalled();

    await click(container.querySelector<HTMLElement>('[aria-label="Remove Ravi"]')!);
    await click(byText('button', 'Remove member', document.body.querySelector('[role="alertdialog"]')!));
    expect(del).toHaveBeenCalledWith('/organizations/o1/members/u2');
  });
});

describe('Admin live tester', () => {
  it('says when the platform checks cannot run', async () => {
    auth.user = { id: 'a1', role: 'admin', name: 'Admin' };
    get.mockRejectedValue(new Error(''));
    await mount('/admin/tester', '/admin/tester', <AdminTester />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to run platform checks.');
  });
});
