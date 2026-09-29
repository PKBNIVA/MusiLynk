import { describe, expect, it } from 'vitest';
import { sortPinnedFirst, type StagePost } from '../stage';

function post(id: string, overrides: Partial<StagePost> = {}): StagePost {
  return {
    id,
    author: { type: 'user', id: 'u1', name: 'Someone' },
    kind: 'update',
    body: 'x',
    media: [],
    linkUrl: null,
    city: null,
    genres: [],
    hashtags: [],
    visibility: 'public',
    status: 'active',
    sharedEntity: null,
    applauseCount: 0,
    commentCount: 0,
    reshareCount: 0,
    applauded: false,
    pinned: false,
    pinnedUntil: null,
    event: null,
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

describe('sortPinnedFirst', () => {
  it('puts a pinned post ahead of newer unpinned posts', () => {
    const pinned = post('pinned', { pinned: true, createdAt: '2026-09-01T00:00:00Z' });
    const newer = post('newer', { createdAt: '2026-09-29T00:00:00Z' });
    const older = post('older', { createdAt: '2026-09-10T00:00:00Z' });

    expect(sortPinnedFirst([older, newer, pinned]).map((p) => p.id)).toEqual(['pinned', 'newer', 'older']);
  });

  it('orders unpinned posts by recency and leaves ties as-is when equally recent', () => {
    const a = post('a', { createdAt: '2026-09-10T00:00:00Z' });
    const b = post('b', { createdAt: '2026-09-15T00:00:00Z' });
    expect(sortPinnedFirst([a, b]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('orders multiple pinned posts among themselves by recency too', () => {
    const first = post('first', { pinned: true, createdAt: '2026-09-01T00:00:00Z' });
    const second = post('second', { pinned: true, createdAt: '2026-09-20T00:00:00Z' });
    expect(sortPinnedFirst([first, second]).map((p) => p.id)).toEqual(['second', 'first']);
  });

  it('does not mutate the input array', () => {
    const list = [post('a'), post('b', { pinned: true })];
    const copy = [...list];
    sortPinnedFirst(list);
    expect(list).toEqual(copy);
  });
});
