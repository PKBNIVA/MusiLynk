import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pricing from '../Pricing';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/api', () => ({
  apiGet: vi.fn().mockRejectedValue(new Error('offline in test')),
}));

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

describe('Pricing page copy (V-flat-fee-note)', () => {
  it('renders the flat-fee and cancel-anytime copy below the plan cards', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Pricing />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const note = container.querySelector('[data-testid="flat-fee-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(
      'One flat fee. No commission on your bookings. A ₹5 lakh wedding band booked through a commission agency costs ₹75,000–₹1,00,000 in fees; on Verse it costs your monthly plan.',
    );
    expect(note?.textContent).toContain(
      'Cancel any time. We email you three days before your trial ends and before every renewal.',
    );

    // Plan prices/limits/CTAs are untouched.
    expect(container.querySelector('[data-testid="pricing-plans"]')?.textContent).toContain('₹2,499');
  });
});
