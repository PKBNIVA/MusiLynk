import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn().mockResolvedValue({}) };
});
import { AuthProvider } from '../../../lib/authContext';
import SiteMapPage from '../SiteMapPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SiteMapPage', () => {
  it('lists all 12 x 16 hire pages, the 16 rates pages and the photo credits', async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <AuthProvider>
            <SiteMapPage />
          </AuthProvider>
        </MemoryRouter>,
      ),
    );
    const map = container.querySelector('[data-testid="hire-map"]')!;
    expect(map.querySelectorAll('a[href^="/hire/"]')).toHaveLength(12 * 16);
    expect(map.querySelectorAll('a[href^="/rates/"]')).toHaveLength(16);
    expect(map.querySelector('a[href="/hire/drummer/mumbai"]')?.textContent).toBe('Hire a drummer in Mumbai');
    // Mumbai is open, the other cities are collapsed.
    expect(map.querySelectorAll('details[open]')).toHaveLength(1);
    expect(container.querySelector('a[href="/credits"]')).not.toBeNull();
  });
});
