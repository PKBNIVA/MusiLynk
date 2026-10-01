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
import LegalPage from '../LegalPage';

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
  vi.mocked(apiGet).mockReset();
});

async function open(path: string, policy: unknown) {
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    if (url.startsWith('/legal/policy')) return policy;
    return {};
  });
  const router = createMemoryRouter([{ path: '/:page', element: <LegalPage /> }], { initialEntries: [path] });
  await act(async () =>
    root.render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  );
  await act(async () => {});
}

const policy = (officer: { name: string; email: string; address: string }, configured: boolean) => ({
  legal: {
    legalName: '',
    gstin: '',
    gstinPresent: false,
    businessAddress: '',
    businessState: '',
    grievanceOfficer: officer,
    configured: {
      legalName: false,
      businessAddress: false,
      businessState: false,
      grievanceOfficer: { name: configured, email: configured, address: configured },
    },
  },
  booking: { feeEnabled: false, plainEnglish: ['A booking fee applies only on completed bookings.'], policyVersion: 3 },
});

describe('LegalPage', () => {
  it('has a photo header, a contents list that links to each section, and related pages', async () => {
    await open('/privacy', policy({ name: '', email: '', address: '' }, false));
    expect(container.querySelector('[data-testid="photo-header"] img')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Privacy Policy');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[data-testid="legal-contents"] a')];
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull();
    const related = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Related pages"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(related).toContain('/terms');
    expect(related).not.toContain('/privacy');
  });

  it('keeps B0\'s guard: no placeholder and no empty "Email:" until the grievance officer is configured', async () => {
    await open('/privacy', policy({ name: '[NAME]', email: '[EMAIL]', address: '[ADDRESS]' }, false));
    expect(container.textContent).toContain('Contact details are published before launch');
    expect(container.textContent).not.toMatch(/\[NAME\]|\[EMAIL\]|\[ADDRESS\]|Email:/);
  });

  it('prints the grievance officer once every field is configured', async () => {
    await open('/privacy', policy({ name: 'Asha Rao', email: 'grievance@verse.example', address: 'Mumbai' }, true));
    expect(container.textContent).toContain('Name: Asha Rao · Email: grievance@verse.example · Address: Mumbai');
    expect(container.textContent).not.toContain('published before launch');
  });

  it('skips the contents list on a short page and fills the width', async () => {
    await open('/contact', policy({ name: '', email: '', address: '' }, false));
    expect(container.querySelector('[data-testid="legal-contents"]')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });
});
