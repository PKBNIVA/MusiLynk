import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn() };
});
import { apiGet } from '../../../lib/api';
import { StageTeaser } from '../StageTeaser';

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

const post = (i: number, body: string, over: Record<string, unknown> = {}) => ({
  id: `s${i}`,
  body,
  visibility: 'public',
  createdAt: '2026-09-20T10:00:00Z',
  ...over,
});

async function show() {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StageTeaser />
      </MemoryRouter>,
    ),
  );
}

describe('StageTeaser', () => {
  it('shows the three newest platform posts and skips welcomes that name one person', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      posts: [
        post(1, 'Welcome Priya, drummer in Mumbai'),
        post(2, 'A Drummer request in Mumbai was filled in 2 hours'),
        post(3, '6 musicians joined this week'),
        post(4, 'Arjun is now Verified'),
        post(5, 'This week: the fastest replies'),
      ],
    });
    await show();
    expect(apiGet).toHaveBeenCalledWith(
      '/stage/authors/system/musilynk/posts',
      expect.objectContaining({ skipAuthRedirect: true, viaEdge: true }),
    );
    const cards = host.querySelectorAll('[data-testid=stage-teaser-post]');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('filled in 2 hours');
    expect(host.textContent).not.toContain('Priya');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/stage');
    expect(host.querySelector('h2')?.textContent).toBe('Latest from The Stage');
  });
  it('renders nothing under three posts, for followers-only posts, or when the request fails', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      posts: [post(1, 'One'), post(2, 'Two'), post(3, 'Three', { visibility: 'followers' })],
    });
    await show();
    expect(host.querySelector('[data-testid=stage-teaser]')).toBeNull();
    vi.mocked(apiGet).mockRejectedValue(new Error('down'));
    await show();
    expect(host.querySelector('[data-testid=stage-teaser]')).toBeNull();
    vi.mocked(apiGet).mockResolvedValue({});
    await show();
    expect(host.querySelector('[data-testid=stage-teaser]')).toBeNull();
  });
});
