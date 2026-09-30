import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSettings from '../AccountSettings';
import { apiPut, uploadMedia } from '../../lib/api';
import { cropSquare } from '../../components/media/cropSquare';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setUser = vi.fn();
let currentUser: Record<string, unknown>;
vi.mock('../../lib/authContext', () => ({ useAuth: () => ({ user: currentUser, setUser }) }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiPut: vi.fn(),
  uploadMedia: vi.fn(),
  getSignInMethods: vi.fn().mockResolvedValue({ providers: {}, connections: [] }),
}));
vi.mock('../../components/media/cropSquare', () => ({ cropSquare: vi.fn() }));
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../components/auth/GoogleButton', () => ({ GoogleButton: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const photoCard = () => container.querySelector('#settings-photo')!.closest('[data-slot=card]') as HTMLElement;
const pick = async (file: File) => {
  const input = container.querySelector('#settings-photo') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
};
const button = (label: string) =>
  Array.from(photoCard().querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: 'u1', name: 'Asha Sharma', email: 'a@x.test', role: 'jobseeker', photoUrl: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <AccountSettings />
      </MemoryRouter>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Photo section on account settings', () => {
  it('offers an upload and shows initials while there is no photo', () => {
    expect(photoCard().textContent).toContain('Upload photo');
    expect(photoCard().textContent).not.toContain('Remove');
    expect(photoCard().querySelector('[data-layer=initials]')?.textContent).toBe('AS');
  });

  it('crops, uploads, saves the URL on the profile and updates the signed-in user', async () => {
    const cropped = new File(['x'], 'photo.webp', { type: 'image/webp' });
    vi.mocked(cropSquare).mockResolvedValue(cropped);
    vi.mocked(uploadMedia).mockResolvedValue({ url: 'https://cdn.test/me.webp' });
    vi.mocked(apiPut).mockResolvedValue({ user: { ...currentUser, photoUrl: 'https://cdn.test/me.webp' } });
    await pick(new File(['raw'], 'me.png', { type: 'image/png' }));
    expect(cropSquare).toHaveBeenCalledOnce();
    expect(uploadMedia).toHaveBeenCalledWith(cropped);
    expect(apiPut).toHaveBeenCalledWith('/profile', { photoUrl: 'https://cdn.test/me.webp' });
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: 'https://cdn.test/me.webp' }));
    expect(toast.success).toHaveBeenCalledWith('Photo updated');
  });

  it('refuses other file types without uploading', async () => {
    await pick(new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    expect(toast.error).toHaveBeenCalledWith('Choose a JPEG, PNG or WebP picture.');
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('reports a failed upload and leaves the user unchanged', async () => {
    vi.mocked(cropSquare).mockResolvedValue(new File(['x'], 'photo.webp', { type: 'image/webp' }));
    vi.mocked(uploadMedia).mockRejectedValue(new Error('Upload failed (500). Please retry.'));
    await pick(new File(['raw'], 'me.jpg', { type: 'image/jpeg' }));
    expect(toast.error).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('removes an existing photo', async () => {
    act(() => root.unmount());
    currentUser = { ...currentUser, photoUrl: 'https://cdn.test/me.webp' };
    root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter>
          <AccountSettings />
        </MemoryRouter>,
      ),
    );
    expect(photoCard().querySelector('[data-layer=photo] img')?.getAttribute('src')).toBe('https://cdn.test/me.webp');
    vi.mocked(apiPut).mockResolvedValue({ user: { ...currentUser, photoUrl: null } });
    await act(async () => {
      button('Remove').click();
    });
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/profile', { photoUrl: '' });
    expect(toast.success).toHaveBeenCalledWith('Photo removed');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: null }));
  });
});
