import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replaces the regex checks in tests/frontend-bootstrap-smoke.mjs: the signed-in navigation asks the
// lightweight unread-count endpoint, never the full notification list.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
}));
vi.mock('../../lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authContext')>()),
  useAuth: () => ({
    user: { id: 'u1', role: 'jobseeker', name: 'Asha', email: 'asha@example.test' },
    status: 'signedIn',
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

import { apiGet } from '../../lib/api';
import { Navigation } from '../Navigation';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.mocked(apiGet).mockImplementation(async (path) =>
    path === '/notifications/unread' ? { unread: 3, unreadMessages: 2 } : {},
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Navigation unread counts', () => {
  it('asks for the unread counts, shows them, and never downloads the notification list', async () => {
    const router = createMemoryRouter([{ path: '/jobseeker', element: <Navigation /> }], {
      initialEntries: ['/jobseeker'],
    });
    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const paths = vi.mocked(apiGet).mock.calls.map(([path]) => path);
    expect(paths).toContain('/notifications/unread');
    expect(paths).not.toContain('/notifications');
    expect(container.querySelector('[data-testid="unread-notifications-badge"]')?.textContent).toBe('3');
    expect(container.querySelector('[data-testid="unread-messages-badge"]')?.textContent).toBe('2');
  });
});
