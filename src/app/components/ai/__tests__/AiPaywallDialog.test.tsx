import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPaywallDialog } from '../AiPaywallDialog';
import { AiPaywallError } from '../../../lib/ai';

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

describe('AiPaywallDialog', () => {
  it('shows a used-up notice for AI_USAGE_LIMIT_REACHED with no purchase buttons', () => {
    const error = new AiPaywallError('AI help is used up for now.', 'AI_USAGE_LIMIT_REACHED', {
      remaining: 0,
      limit: 5,
      period: 'lifetime',
    });
    act(() => root.render(<AiPaywallDialog error={error} onClose={() => {}} />));

    expect(document.body.textContent).toContain('AI help is used up for now');
    expect(document.body.textContent).not.toContain('MusiLynk AI Plus');
    expect(document.body.textContent).not.toContain('Top up');
    expect(document.body.textContent).not.toContain('credit');
  });

  it('mentions next month for a hirer (monthly) usage cap', () => {
    const error = new AiPaywallError('Used up.', 'AI_USAGE_LIMIT_REACHED', {
      remaining: 0,
      limit: 10,
      period: 'month',
    });
    act(() => root.render(<AiPaywallDialog error={error} onClose={() => {}} />));
    expect(document.body.textContent).toContain('next month');
  });

  it('shows the resting notice for AI_FREE_PAUSED, with the exact copy', () => {
    const error = new AiPaywallError('Resting.', 'AI_FREE_PAUSED', {});
    act(() => root.render(<AiPaywallDialog error={error} onClose={() => {}} />));
    expect(document.body.textContent).toContain('AI help is resting this month. Everything else works as usual.');
    expect(document.body.textContent).not.toContain('MusiLynk AI Plus');
  });

  it('calls onClose from the Close button', () => {
    const error = new AiPaywallError('Used up.', 'AI_USAGE_LIMIT_REACHED', {});
    const onClose = vi.fn();
    act(() => root.render(<AiPaywallDialog error={error} onClose={onClose} />));
    const closeButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close');
    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
