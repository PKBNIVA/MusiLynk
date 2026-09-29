import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../lib/__tests__/helpers';
import Unsubscribe from '../Unsubscribe';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/monitoring', () => ({ reportApiFailure: vi.fn() }));
// PublicNav lazy-loads IdentitySwitcher, which needs an AuthProvider this page doesn't have;
// stub it out so the test focuses on the unsubscribe preferences behaviour.
vi.mock('../../components/PublicNav', () => ({ PublicNav: () => null }));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(url: string) {
  const router = createMemoryRouter([{ path: '/unsubscribe', element: <Unsubscribe /> }], { initialEntries: [url] });
  act(() => root.render(<RouterProvider router={router} />));
  return router;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const prefs = { digest: true, lifecycle: true, requests: false, product: true };

describe('Unsubscribe page', () => {
  it('shows an invalid state with no token, without calling the API', async () => {
    mount('/unsubscribe');
    await flush();
    expect(container.querySelector('[data-testid="unsubscribe-status"]')?.textContent).toMatch(/invalid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the master switch and the four category toggles from the token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ emailNotifications: true, emailPreferences: prefs }));
    mount('/unsubscribe?token=abc');
    await flush();

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/notifications/unsubscribe/preferences?token=abc');
    expect(
      (container.querySelector('[data-testid="toggle-master"]') as HTMLButtonElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (container.querySelector('[data-testid="toggle-requests"]') as HTMLButtonElement).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      (container.querySelector('[data-testid="toggle-digest"]') as HTMLButtonElement).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('flipping a category toggle PATCHes just that category', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ emailNotifications: true, emailPreferences: prefs }));
    mount('/unsubscribe?token=abc');
    await flush();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const digestToggle = container.querySelector('[data-testid="toggle-digest"]') as HTMLButtonElement;
    await act(async () => {
      digestToggle.click();
      await Promise.resolve();
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain('/notifications/unsubscribe/preferences');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: 'abc',
      emailPreferences: { digest: false },
    });
  });

  it('turning off the master switch disables the category toggles', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ emailNotifications: true, emailPreferences: prefs }));
    mount('/unsubscribe?token=abc');
    await flush();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const masterToggle = container.querySelector('[data-testid="toggle-master"]') as HTMLButtonElement;
    await act(async () => {
      masterToggle.click();
      await Promise.resolve();
    });

    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ token: 'abc', emailNotifications: false });
    expect((container.querySelector('[data-testid="toggle-digest"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error state when loading preferences fails for a reason other than an invalid token', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    mount('/unsubscribe?token=abc');
    // The GET retries once with a short randomized backoff (api.ts), so wait past it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(container.querySelector('[data-testid="unsubscribe-status"]')?.textContent).toMatch(/couldn.t load/i);
  });
});
