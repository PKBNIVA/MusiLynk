import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ActCard } from '../ActCard';
import type { Act } from '../../../lib/apiTypes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const band = (over: Partial<Act> = {}) =>
  ({
    id: 'a1',
    name: 'The Night Shift',
    act_type: 'wedding-band',
    city: 'Pune',
    min_fee: 45000,
    currency: 'INR',
    genres: ['Bollywood', 'Sufi', 'Folk', 'Jazz'],
    members: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    ownerName: 'Riya',
    ownerVerified: true,
    demo: false,
    status: 'active',
    ...over,
  }) as Act;

function render(a: Act) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    createRoot(host).render(
      <MemoryRouter>
        <ActCard act={a} index={0} to="/acts/a1" />
      </MemoryRouter>,
    ),
  );
  return host;
}

describe('ActCard', () => {
  it('shows cover art, from price, lineup size and at most three genres', () => {
    const host = render(band());
    expect(host.querySelector('[data-testid="cover-art"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="from-rate"]')?.textContent).toBe('from ₹45,000');
    expect(host.textContent).toContain('3 members');
    expect(host.textContent).toContain('Pune');
    expect(host.textContent).toContain('Folk');
    expect(host.textContent).not.toContain('Jazz');
  });

  it('asks for a quote when no fee is published', () => {
    const host = render(band({ min_fee: null }));
    expect(host.querySelector('[data-testid="from-rate"]')).toBeNull();
    expect(host.textContent).toContain('Ask for a quote');
  });

  it('uses the uploaded photo, except on a demo act', () => {
    const real = render(band({ photo_url: 'https://cdn.example.com/band.webp' }));
    expect(real.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/band.webp');
    const demo = render(band({ photo_url: 'https://cdn.example.com/band.webp', demo: true }));
    expect(demo.querySelector('img')).toBeNull();
    expect(demo.querySelector('[data-testid="cover-art"]')).toBeTruthy();
  });
});
