import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiGet } from '../../lib/api';
import { VouchCard } from '../VouchCard';

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
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('VouchCard', () => {
  it('shows the 3-slot indicator and hides the form once all 3 are used', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      vouches: [
        { id: '1', voucher_id: 'v', vouchee_email: 'a@example.com', status: 'invited', voucherName: 'Me' },
        { id: '2', voucher_id: 'v', vouchee_email: 'b@example.com', status: 'joined', voucherName: 'Me' },
        { id: '3', voucher_id: 'v', vouchee_email: 'c@example.com', status: 'verified', voucherName: 'Me' },
      ],
    });
    act(() => root.render(<VouchCard />));
    await flush();

    expect(container.textContent).toContain('3/3 used');
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).toContain('a@example.com');
  });

  it('shows the invite form when fewer than 3 slots are used', async () => {
    vi.mocked(apiGet).mockResolvedValue({ vouches: [] });
    act(() => root.render(<VouchCard />));
    await flush();

    expect(container.textContent).toContain('0/3 used');
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });
});
