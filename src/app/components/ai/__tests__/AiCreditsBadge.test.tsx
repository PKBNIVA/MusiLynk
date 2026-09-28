import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCreditsBadge } from '../AiCreditsBadge';

vi.mock('../../../lib/ai', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/ai')>('../../../lib/ai');
  return { ...actual, useAiUsage: vi.fn() };
});
import { useAiUsage } from '../../../lib/ai';

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

describe('AiCreditsBadge', () => {
  it('renders nothing while usage has not loaded', () => {
    vi.mocked(useAiUsage).mockReturnValue({ usage: null, reload: () => {} });
    act(() => root.render(<AiCreditsBadge />));
    expect(container.innerHTML).toBe('');
  });

  it('shows the balance once usage loads', () => {
    vi.mocked(useAiUsage).mockReturnValue({
      usage: {
        balance: 17,
        monthlyAllowance: 20,
        usedThisPeriod: 3,
        resetsAt: '2026-10-01T00:00:00Z',
        plan: 'free',
        recent: [],
      },
      reload: () => {},
    });
    act(() => root.render(<AiCreditsBadge />));
    const badge = container.querySelector('[data-testid="ai-credits-badge"]');
    expect(badge?.textContent).toContain('17 AI credits');
  });
});
