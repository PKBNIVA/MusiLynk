import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// J-26: the "check your email" toast is cleared once the person is moving between pages.
// J-16: a hirer's top bar has Book talent, not the musician's performing tools.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const dismiss = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { dismiss } }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(async () => ({ unread: 0, unreadMessages: 0 })),
}));
vi.mock('../../lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authContext')>()),
  useAuth: () => ({
    user: { id: 'h1', role: 'employer', name: 'Hira', email: 'hira@example.test' },
    status: 'signedIn',
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

import { SIGN_IN_CODE_TOAST } from '../../lib/authToasts';
import { Navigation } from '../Navigation';

let container: HTMLDivElement;
let root: Root;

const renderAt = async (path: string) => {
  const router = createMemoryRouter([{ path: '/employer/*', element: <Navigation /> }], {
    initialEntries: [path],
  });
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
};

beforeEach(() => {
  dismiss.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Navigation for a hirer', () => {
  it('clears the sign-in code toast on arrival and on every route change', async () => {
    const router = await renderAt('/employer');
    expect(dismiss).toHaveBeenCalledWith(SIGN_IN_CODE_TOAST);
    const before = dismiss.mock.calls.length;
    await act(async () => {
      await router.navigate('/employer/bookings');
    });
    expect(dismiss.mock.calls.length).toBeGreaterThan(before);
    expect(dismiss).toHaveBeenLastCalledWith(SIGN_IN_CODE_TOAST);
  });

  it('offers Book talent and no performer tools', async () => {
    await renderAt('/employer');
    const nav = container.querySelector('nav[aria-label="Workspace navigation"]');
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toContain('Book talent');
    expect(nav?.textContent).not.toContain('Perform & book');
    expect(nav?.textContent).not.toContain('My acts');
  });
});
