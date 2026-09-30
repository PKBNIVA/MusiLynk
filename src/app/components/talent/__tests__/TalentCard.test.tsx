import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { TalentCard } from '../TalentCard';
import type { Professional } from '../../../lib/apiTypes';

vi.mock('../FirstSample', () => ({
  FirstSample: ({ id }: { id: string }) => <div data-testid="first-sample">{id}</div>,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const person = (over: Partial<Professional> = {}) =>
  ({
    id: 'u1',
    name: 'Asha Kulkarni',
    role: 'jobseeker',
    headline: 'Playback singer',
    roles: ['Vocalist'],
    genres: ['Ghazal', 'Bollywood'],
    instruments: ['Harmonium', 'Vocals'],
    skills: ['Sight-reading'],
    location: 'Mumbai',
    verified: true,
    sessionRate: 8000,
    dayRate: 20000,
    reviewsCount: 12,
    reviewsAverage: 4.75,
    bookingsCount: 3,
    responseTimeMinutes: 25,
    ...over,
  }) as Professional;

function render(p: Professional) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    createRoot(host).render(
      <MemoryRouter>
        <TalentCard person={p} index={2} to="/professionals/u1" footer={<button>Message</button>} />
      </MemoryRouter>,
    ),
  );
  return host;
}

describe('TalentCard', () => {
  it('shows the facts a hirer compares: from price, reviews, bookings and reply time', () => {
    const host = render(person());
    expect(host.querySelector('h2')?.textContent).toBe('Asha Kulkarni');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/professionals/u1');
    expect(host.querySelector('[data-testid="from-rate"]')?.textContent).toBe('from ₹8,000');
    const facts = host.querySelector('[data-testid="talent-facts"]')?.textContent ?? '';
    expect(facts).toContain('4.8 (12)');
    expect(facts).toContain('3 bookings');
    expect(facts).toContain('Replies in ~25 min');
    expect(host.textContent).toContain('Mumbai');
    expect(host.querySelector('[aria-label="Verified"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="first-sample"]')?.textContent).toBe('u1');
    expect(host.querySelector('[data-list-item="2"]')).toBeTruthy();
    expect(host.textContent).toContain('Message');
  });

  it('leaves out what is not known instead of printing zeros', () => {
    const host = render(
      person({
        sessionRate: null,
        dayRate: null,
        reviewsCount: 0,
        reviewsAverage: null,
        bookingsCount: 0,
        responseTimeMinutes: null,
      }),
    );
    expect(host.querySelector('[data-testid="from-rate"]')).toBeNull();
    expect(host.querySelector('[data-testid="talent-facts"]')).toBeNull();
    expect(host.textContent).not.toContain('booking');
    expect(host.textContent).not.toContain('Replies');
  });

  it('draws generated art for a demo account and the photo for a real one', () => {
    const demo = render(person({ demo: true, photoUrl: null }));
    expect(demo.querySelector('[data-testid="user-avatar"]')?.getAttribute('data-layer')).toBe('art');
    expect(demo.querySelector('[data-testid="demo-badge"]')).toBeTruthy();
    expect(demo.querySelector('img')).toBeNull();
    const real = render(person({ demo: false, photoUrl: 'https://cdn.example.com/face.webp' }));
    expect(real.querySelector('[data-testid="user-avatar"]')?.getAttribute('data-layer')).toBe('photo');
    expect(real.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/face.webp');
  });

  it('shows at most three chips, none repeating the role or genre lines', () => {
    const host = render(person({ instruments: ['Harmonium', 'Tanpura', 'Keys', 'Vocals'], skills: ['Arranging'] }));
    const chips = [...host.querySelectorAll('[data-testid="talent-chips"] span')].map((x) => x.textContent);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips).toContain('Harmonium');
  });
});
