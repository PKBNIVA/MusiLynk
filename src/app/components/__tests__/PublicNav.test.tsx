import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../lib/__tests__/helpers';
import { PublicNav } from '../PublicNav';
import { AuthProvider } from '../../lib/authContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <AuthProvider>
          <PublicNav />
        </AuthProvider>
      ),
    },
  ]);
  act(() => root.render(<RouterProvider router={router} />));
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('PublicNav', () => {
  it('shows the signed-out header immediately when there is no stored token', async () => {
    mount();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="account-menu"]')).toBeNull();
    expect(container.textContent).toContain('Sign in');
    expect(container.textContent).toContain('Join Verse');
  });

  it('renders the neutral header (no auth buttons) while a stored token is still being verified', async () => {
    let resolveMe!: (response: Response) => void;
    localStorage.setItem('verse_access_token', 'tok');
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );
    mount();
    // Still loading: neither the signed-out nor the signed-in controls have appeared yet.
    expect(container.querySelector('[data-testid="account-menu"]')).toBeNull();
    expect(container.textContent).not.toContain('Join Verse');

    await act(async () => {
      resolveMe(jsonResponse({ user: { id: 'u1', name: 'Asha', role: 'jobseeker' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="account-menu"]')).not.toBeNull();
    expect(container.textContent).toContain('Asha');
  });

  it('shows the account menu once the stored token resolves to a signed-in user', async () => {
    localStorage.setItem('verse_access_token', 'tok');
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: 'u1', name: 'Ravi', role: 'employer' } }));
    mount();
    await settle();
    expect(container.querySelector('[data-testid="account-menu"]')).not.toBeNull();
    expect(container.textContent).toContain('Ravi');
    expect(container.textContent).not.toContain('Join Verse');
  });

  it('clears the token and shows signed-out once /me rejects with 401', async () => {
    localStorage.setItem('verse_access_token', 'tok');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    mount();
    await settle();
    expect(localStorage.getItem('verse_access_token')).toBeNull();
    expect(container.querySelector('[data-testid="account-menu"]')).toBeNull();
    expect(container.textContent).toContain('Sign in');
  });
});
