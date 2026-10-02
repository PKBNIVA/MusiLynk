import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() };
});
import { apiDelete, apiGet, apiPatch, apiPost } from '../api';

const mockUseAuth = vi.fn();
vi.mock('../authContext', () => ({ useAuth: () => mockUseAuth() }));

import {
  addApplause,
  addComment,
  authorPath,
  createPost,
  deleteComment,
  deletePost,
  embedPreviewFor,
  fetchAuthorPosts,
  fetchComments,
  fetchFeed,
  fetchFollowers,
  fetchFollowing,
  fetchPost,
  fetchTagPosts,
  followActor,
  isOwnedByActor,
  mediaUrlFor,
  POST_KIND_LABEL,
  relativeTime,
  removeApplause,
  rememberMediaUrl,
  splitHashtags,
  groupFeed,
  isSystemPost,
  unfollowActor,
  updatePost,
  useActingAs,
  type ActingAsOption,
  type StageAuthor,
  type StagePost,
} from '../stage';

const user: StageAuthor = { type: 'user', id: 'user_1', name: 'Jane Doe' };

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('splitHashtags', () => {
  it('returns the whole body as one text segment with no hashtags', () => {
    expect(splitHashtags('just a normal post')).toEqual([{ kind: 'text', value: 'just a normal post' }]);
  });

  it('splits hashtags into their own segments, stripped of the #', () => {
    expect(splitHashtags('Great gig in #mumbai tonight #jazz!')).toEqual([
      { kind: 'text', value: 'Great gig in ' },
      { kind: 'hashtag', value: 'mumbai' },
      { kind: 'text', value: ' tonight ' },
      { kind: 'hashtag', value: 'jazz' },
      { kind: 'text', value: '!' },
    ]);
  });

  it('links tags in any script and leaves single-character tags as text', () => {
    expect(splitHashtags('आज #मुंबई में #a gig')).toEqual([
      { kind: 'text', value: 'आज ' },
      { kind: 'hashtag', value: 'मुंबई' },
      { kind: 'text', value: ' में #a gig' },
    ]);
  });

  it('handles a body that is only a hashtag', () => {
    expect(splitHashtags('#jazz')).toEqual([{ kind: 'hashtag', value: 'jazz' }]);
  });
});

describe('relativeTime', () => {
  it('returns "just now" for a timestamp seconds ago', () => {
    expect(relativeTime(new Date(Date.now() - 5_000).toISOString())).toBe('just now');
  });

  it('returns minutes, hours and days as they pass', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m');
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h');
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2d');
  });

  it('falls back to a short date after a week', () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(relativeTime(old)).not.toMatch(/[md]$/);
  });

  it('returns an empty string for an invalid date', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });
});

describe('embedPreviewFor', () => {
  it('returns null for no url', () => {
    expect(embedPreviewFor(null)).toBeNull();
    expect(embedPreviewFor(undefined)).toBeNull();
  });

  it('returns null for a plain link', () => {
    expect(embedPreviewFor('https://example.com/song')).toBeNull();
  });

  it('recognises a youtube watch link', () => {
    expect(embedPreviewFor('https://www.youtube.com/watch?v=abc123XYZ')).toEqual({
      kind: 'youtube',
      embedUrl: 'https://www.youtube.com/embed/abc123XYZ',
    });
  });

  it('recognises a youtu.be short link', () => {
    expect(embedPreviewFor('https://youtu.be/abc123XYZ')).toEqual({
      kind: 'youtube',
      embedUrl: 'https://www.youtube.com/embed/abc123XYZ',
    });
  });

  it('recognises an instagram reel link', () => {
    expect(embedPreviewFor('https://www.instagram.com/reel/Cabc123/')).toEqual({
      kind: 'instagram',
      embedUrl: 'https://www.instagram.com/p/Cabc123/embed',
    });
  });
});

describe('isOwnedByActor', () => {
  it('is true for the post author being the signed-in person', () => {
    expect(isOwnedByActor(user, 'user_1')).toBe(true);
  });

  it('is false for someone else with no active Page', () => {
    expect(isOwnedByActor(user, 'user_2')).toBe(false);
  });

  it('is true when the author matches the currently-acted-as Page', () => {
    const page: StageAuthor = { type: 'act', id: 'act_1', name: 'The Band' };
    expect(isOwnedByActor(page, 'user_2', page)).toBe(true);
  });

  it('is false when the author does not match self or the active Page', () => {
    const page: StageAuthor = { type: 'act', id: 'act_1', name: 'The Band' };
    const other: StageAuthor = { type: 'act', id: 'act_2', name: 'Other Band' };
    expect(isOwnedByActor(other, 'user_2', page)).toBe(false);
  });
});

describe('mediaUrlFor / rememberMediaUrl', () => {
  it('returns undefined until a url is remembered, then returns it', () => {
    expect(mediaUrlFor({ uploadId: 'upld_never_seen' })).toBeUndefined();
    rememberMediaUrl('upld_1', 'https://cdn.example.com/upld_1.jpg');
    expect(mediaUrlFor({ uploadId: 'upld_1' })).toBe('https://cdn.example.com/upld_1.jpg');
  });

  it('prefers the url the API supplies with the post', () => {
    rememberMediaUrl('upld_2', 'https://cdn.example.com/cached.jpg');
    expect(mediaUrlFor({ uploadId: 'upld_2', url: 'https://cdn.example.com/api.jpg' })).toBe(
      'https://cdn.example.com/api.jpg',
    );
  });
});

describe('authorPath', () => {
  it('builds a stage author path, URL-encoding the id', () => {
    expect(authorPath({ type: 'act', id: 'act 1', name: 'x' })).toBe('/stage/authors/act/act%201');
  });
});

describe('POST_KIND_LABEL', () => {
  it('has a label for every documented post kind', () => {
    expect(Object.keys(POST_KIND_LABEL).sort()).toEqual(
      [
        'event',
        'gig',
        'job_share',
        'looking_for',
        'performance',
        'portfolio_share',
        'release',
        'system',
        'update',
      ].sort(),
    );
  });
});

describe('API wrappers', () => {
  it('fetchFeed hits GET /stage/feed, with the cursor when given', async () => {
    vi.mocked(apiGet).mockResolvedValue({ posts: [], nextCursor: null });
    await fetchFeed();
    expect(apiGet).toHaveBeenCalledWith('/stage/feed');
    await fetchFeed('abc==');
    expect(apiGet).toHaveBeenCalledWith('/stage/feed?cursor=abc%3D%3D');
  });

  it('fetchAuthorPosts / fetchTagPosts / fetchPost hit their documented paths', async () => {
    vi.mocked(apiGet).mockResolvedValue({ posts: [], nextCursor: null });
    await fetchAuthorPosts('act', 'act_1');
    expect(apiGet).toHaveBeenCalledWith('/stage/authors/act/act_1/posts');
    await fetchTagPosts('#Jazz');
    expect(apiGet).toHaveBeenCalledWith('/stage/tags/Jazz');
    vi.mocked(apiGet).mockResolvedValue({ post: {} });
    await fetchPost('post_1');
    expect(apiGet).toHaveBeenCalledWith('/stage/posts/post_1');
  });

  it('createPost posts to /stage/posts with the acting-as header when given', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 'post_1', post: {} });
    await createPost({ body: 'hi' }, { 'X-MusiLynk-Act-As': 'act:act_1' });
    expect(apiPost).toHaveBeenCalledWith(
      '/stage/posts',
      { body: 'hi' },
      { headers: { 'X-MusiLynk-Act-As': 'act:act_1' } },
    );
  });

  it('updatePost / deletePost hit PATCH and DELETE on the post', async () => {
    vi.mocked(apiPatch).mockResolvedValue({ post: {} });
    await updatePost('post_1', { body: 'edited' });
    expect(apiPatch).toHaveBeenCalledWith('/stage/posts/post_1', { body: 'edited' });
    vi.mocked(apiDelete).mockResolvedValue({ ok: true });
    await deletePost('post_1');
    expect(apiDelete).toHaveBeenCalledWith('/stage/posts/post_1');
  });

  it('applause add/remove hit the documented endpoints', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true, applauseCount: 1 });
    await addApplause('post_1');
    expect(apiPost).toHaveBeenCalledWith('/stage/posts/post_1/applause', undefined, { headers: undefined });
    vi.mocked(apiDelete).mockResolvedValue({ ok: true, applauseCount: 0 });
    await removeApplause('post_1');
    expect(apiDelete).toHaveBeenCalledWith('/stage/posts/post_1/applause');
  });

  it('comments: fetch, add (with optional parent) and delete', async () => {
    vi.mocked(apiGet).mockResolvedValue({ comments: [] });
    await fetchComments('post_1');
    expect(apiGet).toHaveBeenCalledWith('/stage/posts/post_1/comments');
    vi.mocked(apiPost).mockResolvedValue({ id: 'c_1', comment: {} });
    await addComment('post_1', 'nice!', 'c_0');
    expect(apiPost).toHaveBeenCalledWith(
      '/stage/posts/post_1/comments',
      { body: 'nice!', parentId: 'c_0' },
      { headers: undefined },
    );
    vi.mocked(apiDelete).mockResolvedValue({ ok: true });
    await deleteComment('c_1');
    expect(apiDelete).toHaveBeenCalledWith('/stage/comments/c_1');
  });

  it('follow / unfollow / followers / following hit the documented endpoints', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true, following: true });
    await followActor('user', 'user_2');
    expect(apiPost).toHaveBeenCalledWith('/stage/follows', { followableType: 'user', followableId: 'user_2' });
    vi.mocked(apiDelete).mockResolvedValue({ ok: true, following: false });
    await unfollowActor('user', 'user_2');
    expect(apiDelete).toHaveBeenCalledWith('/stage/follows/user/user_2');
    vi.mocked(apiGet).mockResolvedValue({ followersCount: 3, following: false });
    await fetchFollowers('user', 'user_2');
    expect(apiGet).toHaveBeenCalledWith('/stage/authors/user/user_2/followers');
    vi.mocked(apiGet).mockResolvedValue({ followingCount: 3 });
    await fetchFollowing('user_2');
    expect(apiGet).toHaveBeenCalledWith('/stage/authors/user/user_2/following');
  });
});

describe('useActingAs', () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: ReturnType<typeof useActingAs> | null;

  function Harness() {
    seen = useActingAs();
    return null;
  }

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    root = createRoot(container);
    seen = null;
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('is signed out with no options when there is no user', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    await act(async () => root.render(<Harness />));
    expect(seen?.options).toEqual([]);
    expect(seen?.active).toBeUndefined();
    expect(seen?.header).toBeUndefined();
  });

  it('defaults to acting as yourself, listing owned acts and administered organizations', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user_1', name: 'Jane Doe', verified: true } });
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/acts/me') return Promise.resolve({ acts: [{ id: 'act_1', name: 'The Band' }] });
      if (path === '/organizations')
        return Promise.resolve({
          organizations: [
            { id: 'org_1', name: 'Owned Studio', memberRole: 'owner' },
            { id: 'org_2', name: 'Member Only', memberRole: 'member' },
          ],
        });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await act(async () => root.render(<Harness />));
    await act(async () => Promise.resolve());
    const keys = (seen?.options as ActingAsOption[]).map((o) => o.key);
    expect(keys).toEqual(['user:user_1', 'act:act_1', 'organization:org_1']);
    expect(seen?.active?.key).toBe('user:user_1');
    expect(seen?.header).toBeUndefined();
  });

  it('switching to a Page persists the choice and sets the acting-as header', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user_1', name: 'Jane Doe' } });
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/acts/me') return Promise.resolve({ acts: [{ id: 'act_1', name: 'The Band' }] });
      return Promise.resolve({ organizations: [] });
    });
    await act(async () => root.render(<Harness />));
    await act(async () => Promise.resolve());
    act(() => seen?.setActive('act:act_1'));
    expect(seen?.active?.key).toBe('act:act_1');
    expect(seen?.header).toEqual({ 'X-MusiLynk-Act-As': 'act:act_1' });
    expect(localStorage.getItem('musilynk_stage_acting_as:user_1')).toBe('act:act_1');
  });

  it('a failed acts/organizations fetch still resolves to acting as yourself', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user_1', name: 'Jane Doe' } });
    vi.mocked(apiGet).mockRejectedValue(new Error('network'));
    await act(async () => root.render(<Harness />));
    await act(async () => Promise.resolve());
    expect(seen?.options.map((o) => o.key)).toEqual(['user:user_1']);
    expect(seen?.loading).toBe(false);
  });
});

describe('groupFeed', () => {
  const make = (id: string, kind: StagePost['kind'], system = false) =>
    ({ id, kind, author: { type: system ? 'system' : 'user', id: 'a', name: 'A', system } }) as unknown as StagePost;

  it('collapses consecutive system posts into one entry and leaves a lone one alone', () => {
    const feed = [
      make('1', 'system', true),
      make('2', 'system', true),
      make('3', 'update'),
      make('4', 'system', true),
      make('5', 'update'),
      make('6', 'system', true),
      make('7', 'system', true),
      make('8', 'system', true),
    ];
    const entries = groupFeed(feed);
    expect(entries.map((e) => e.kind)).toEqual(['system', 'post', 'post', 'post', 'system']);
    expect(entries[0].kind === 'system' && entries[0].posts.map((p) => p.id)).toEqual(['1', '2']);
    expect(entries[4].kind === 'system' && entries[4].posts).toHaveLength(3);
  });

  it('turns a feed of only system posts into one entry, so an empty Stage is not five identical cards', () => {
    const feed = ['1', '2', '3', '4', '5'].map((id) => make(id, 'system', true));
    const entries = groupFeed(feed);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind === 'system' && entries[0].posts).toHaveLength(5);
    expect(feed.every(isSystemPost)).toBe(true);
    expect(isSystemPost(make('6', 'update'))).toBe(false);
  });
});
