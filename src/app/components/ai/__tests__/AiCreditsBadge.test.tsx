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

  it('shows how much AI help is left once usage loads, with no "credits" wording', () => {
    vi.mocked(useAiUsage).mockReturnValue({
      usage: { remaining: 3, limit: 5, period: 'lifetime' },
      reload: () => {},
    });
    act(() => root.render(<AiCreditsBadge />));
    const badge = container.querySelector('[data-testid="ai-credits-badge"]');
    expect(badge?.textContent).toContain('AI help: 3 of 5 left');
    expect(container.textContent).not.toContain('credit');
  });

  it('shows the monthly period for a hirer task group', () => {
    vi.mocked(useAiUsage).mockReturnValue({
      usage: { remaining: 4, limit: 10, period: 'month' },
      reload: () => {},
    });
    act(() => root.render(<AiCreditsBadge />));
    const badge = container.querySelector('[data-testid="ai-credits-badge"]');
    expect(badge?.textContent).toContain('AI help: 4 of 10 left');
  });
});
