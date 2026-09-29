import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fakeUser } = vi.hoisted(() => ({
  fakeUser: {
    id: 'user-123',
    name: 'Test Musician',
    email: 'musician@example.com',
    role: 'jobseeker',
    status: 'active',
    profileComplete: true,
    emailVerified: true,
    verified: false,
  },
}));

vi.mock('../../lib/api', () => ({
  apiGet: vi.fn((path: string) => {
    if (path === '/me') return Promise.resolve({ user: fakeUser });
    return Promise.reject(new Error(`unmocked GET ${path}`));
  }),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPut: vi.fn().mockResolvedValue({ user: fakeUser }),
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({ setUser: vi.fn(), user: fakeUser }),
}));

vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../components/help/HelpCallout', () => ({ HelpCallout: () => null }));
vi.mock('../../components/help/MoreDetails', () => ({ MoreDetails: () => null }));
vi.mock('../../components/help/StepForm', () => ({
  StepForm: () => null,
  ReviewRow: () => null,
  focusStepHeading: () => undefined,
}));
vi.mock('../../components/ui/checkbox', () => ({ Checkbox: () => null }));
vi.mock('../../components/VerificationDialogs', () => ({
  VerificationRequestDialog: () => null,
  DebugLinkDialog: () => null,
}));
vi.mock('../../components/ui/app-select', () => ({ AppSelect: () => null }));
vi.mock('../../components/ai/AiSuggestButton', () => ({ AiSuggestButton: () => null }));
vi.mock('../../components/ai/AutocompleteInput', () => ({ AutocompleteInput: () => null }));
vi.mock('../../components/ai/AiCreditsBadge', () => ({ AiCreditsBadge: () => null }));

import ProfileSetup from '../ProfileSetup';

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ProfileSetup public profile link (V-12)', () => {
  it('renders a link to the public profile once the profile is complete', async () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <ProfileSetup />
        </MemoryRouter>,
      ),
    );
    await flush();
    const link = container.querySelector('a[href="/professionals/user-123"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('View public profile');
  });
});
