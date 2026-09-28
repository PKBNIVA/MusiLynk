import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPaywallDialog } from '../AiPaywallDialog';
import { AiPaywallError } from '../../../lib/ai';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const upgradeOptions = {
  aiPlus: { planCode: 'ai_plus', priceInr: 199, creditsPerMonth: 400 },
  topups: { small: { priceInr: 99, credits: 150 }, large: { priceInr: 399, credits: 700 } },
};

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
  it('shows the balance and both offers for AI_CREDITS_EXHAUSTED when billing is enabled', () => {
    const error = new AiPaywallError("You're out of AI credits.", 'AI_CREDITS_EXHAUSTED', {
      balance: 0,
      resetsAt: '2026-10-01T00:00:00Z',
      upgradeOptions,
    });
    const onSubscribePlus = vi.fn();
    const onBuyTopup = vi.fn();
    act(() =>
      root.render(
        <AiPaywallDialog error={error} onClose={() => {}} onSubscribePlus={onSubscribePlus} onBuyTopup={onBuyTopup} />,
      ),
    );

    expect(document.body.textContent).toContain('AI credits');
    expect(document.body.textContent).toContain('Verse AI Plus');
    const buttons = Array.from(document.querySelectorAll('button'));
    const plusButton = buttons.find((b) => b.textContent?.includes('Verse AI Plus'));
    plusButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSubscribePlus).toHaveBeenCalled();
  });

  it('hides the offers for AI_HARD_PAUSED even when billing is enabled', () => {
    const error = new AiPaywallError('Paused.', 'AI_HARD_PAUSED', { upgradeOptions });
    act(() =>
      root.render(
        <AiPaywallDialog error={error} onClose={() => {}} onSubscribePlus={() => {}} onBuyTopup={() => {}} />,
      ),
    );
    expect(document.body.textContent).not.toContain('Verse AI Plus');
  });

  it('hides the offers entirely when billing is disabled', () => {
    const error = new AiPaywallError('Out of credits.', 'AI_CREDITS_EXHAUSTED', { upgradeOptions });
    act(() =>
      root.render(
        <AiPaywallDialog
          error={error}
          onClose={() => {}}
          billingEnabled={false}
          onSubscribePlus={() => {}}
          onBuyTopup={() => {}}
        />,
      ),
    );
    expect(document.body.textContent).not.toContain('Verse AI Plus');
  });

  it('calls onClose from the Close button', () => {
    const error = new AiPaywallError('Out of credits.', 'AI_CREDITS_EXHAUSTED', {});
    const onClose = vi.fn();
    act(() => root.render(<AiPaywallDialog error={error} onClose={onClose} />));
    const closeButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close');
    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
