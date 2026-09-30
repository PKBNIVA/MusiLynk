import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn() };
});
import { apiGet } from '../../../lib/api';
import { NowOnVerse } from '../NowOnVerse';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const person = (i: number, over: Record<string, unknown> = {}) => ({
  id: `p${i}`,
  name: `Person ${i}`,
  role: 'jobseeker',
  headline: 'Session drummer',
  location: 'Mumbai',
  roles: ['Drummer'],
  genres: ['Bollywood'],
  sessionRate: 8000,
  dayRate: 12000,
  ...over,
});

async function show(city = 'Mumbai') {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <NowOnVerse city={city} />
      </MemoryRouter>,
    ),
  );
}

describe('NowOnVerse', () => {
  it('shows up to six cards: art for demo people, initials for the rest, "from" price, verified and demo chips', async () => {
    const talent = Array.from({ length: 8 }, (_, i) => person(i));
    talent[0] = person(0, { demo: true, verified: true, verificationTier: 'verified' });
    vi.mocked(apiGet).mockResolvedValue({ talent });
    await show();
    expect(apiGet).toHaveBeenCalledWith('/public/talent?location=Mumbai&limit=6', { skipAuthRedirect: true });
    const cards = host.querySelectorAll('[data-testid=now-card]');
    expect(cards).toHaveLength(6);
    expect(cards[0].textContent).toContain('Person 0');
    expect(cards[0].textContent).toContain('Verified');
    expect(cards[0].textContent).toContain('Demo');
    expect(cards[0].textContent).toContain('from ₹8,000');
    expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/professionals/p0');
    // Demo profiles get generated art, never a photo of anyone.
    expect(cards[0].querySelector('img')).toBeNull();
    expect(cards[0].querySelector('[data-testid=user-avatar]')?.getAttribute('data-layer')).not.toBe('photo');
    expect(cards[1].querySelector('[data-layer=initials]')).not.toBeNull();
    expect(host.querySelector('h2')?.textContent).toBe('Now on Verse in Mumbai');
  });
  it('uses the photo a real person uploaded', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      talent: [person(1, { photoUrl: 'https://media.example.org/a.webp' }), person(2), person(3)],
    });
    await show();
    expect(host.querySelector('[data-layer=photo] img')?.getAttribute('src')).toBe('https://media.example.org/a.webp');
  });
  it('renders nothing under three people or when the request fails', async () => {
    vi.mocked(apiGet).mockResolvedValue({ talent: [person(1), person(2)] });
    await show();
    expect(host.querySelector('[data-testid=now-on-verse]')).toBeNull();
    vi.mocked(apiGet).mockRejectedValue(new Error('down'));
    await show('Pune');
    expect(host.querySelector('[data-testid=now-on-verse]')).toBeNull();
  });
});
