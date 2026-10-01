import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSettings from '../AccountSettings';
import { apiPost } from '../../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setUser = vi.fn();
let currentUser: Record<string, unknown>;
vi.mock('../../lib/authContext', () => ({ useAuth: () => ({ user: currentUser, setUser }) }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiPost: vi.fn(),
  getSignInMethods: vi.fn().mockResolvedValue({ providers: {}, connections: [] }),
}));
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../components/auth/GoogleButton', () => ({ GoogleButton: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

function mount(user: Record<string, unknown>) {
  currentUser = user;
  act(() =>
    root.render(
      <MemoryRouter>
        <AccountSettings />
      </MemoryRouter>,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AccountSettings password card', () => {
  it('asks for the current password when the account has one', () => {
    mount({ id: 'u1', name: 'Asha Sharma', email: 'a@x.test', role: 'jobseeker', passwordSet: true });
    expect(container.querySelector('#settings-current-password')).toBeTruthy();
    expect(container.textContent).toContain('Update password');
  });

  it('lets a code-only account set a first password without a current one', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true });
    mount({ id: 'u1', name: 'Asha Sharma', email: 'a@x.test', role: 'jobseeker', passwordSet: false });
    expect(container.querySelector('#settings-current-password')).toBeNull();
    expect(container.textContent).toContain('Set a password');

    const input = container.querySelector('#settings-new-password') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'Tabla-Raag-2026-Verse');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Set password'),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
    });
    expect(apiPost).toHaveBeenCalledWith('/account/password', { newPassword: 'Tabla-Raag-2026-Verse' });
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ passwordSet: true }));
  });
});
