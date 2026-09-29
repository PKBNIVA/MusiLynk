// The Stage: types, API calls and small helpers shared by every Stage page/component.
// See backend/docs/api-stage-feed.md for the full contract this file wraps.
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, apiDelete, apiGet, apiPatch, apiPost } from './api';
import { useAuth } from './authContext';
import type { Act, Job, Organization, PortfolioItem } from './apiTypes';

export type StageAuthorType = 'user' | 'organization' | 'act' | 'system';

export interface StageAuthor {
  type: StageAuthorType;
  id: string;
  name: string;
  avatar?: string | null;
  verified?: boolean;
  /** True for the platform's own "Verse" author (StageSystemPostsJob, FastResponderWeekJob). */
  system?: boolean;
}

export type PostKind =
  'update' | 'performance' | 'release' | 'gig' | 'looking_for' | 'job_share' | 'portfolio_share' | 'system' | 'event';

export interface StageEvent {
  title: string | null;
  startsAt: string | null;
  venue: string | null;
  city: string | null;
  link: string | null;
  featured: boolean;
}

export interface StageMedia {
  uploadId: string;
  type: 'image' | 'audio' | 'video';
  caption?: string;
}

export type SharedEntity =
  | { type: 'portfolio_item'; item: PortfolioItem; unavailable?: false }
  | { type: 'job'; job: Job; applyOpen: boolean; unavailable?: false }
  | { type: 'post'; post: StagePost; unavailable?: false }
  | { type: 'portfolio_item' | 'job' | 'post'; unavailable: true }
  | null;

export interface StagePost {
  id: string;
  author: StageAuthor;
  kind: PostKind;
  body: string | null;
  media: StageMedia[];
  linkUrl: string | null;
  city: string | null;
  genres: string[];
  hashtags: string[];
  visibility: 'public' | 'followers';
  status: string;
  sharedEntity: SharedEntity;
  applauseCount: number;
  commentCount: number;
  reshareCount: number;
  applauded: boolean;
  pinned: boolean;
  pinnedUntil: string | null;
  event: StageEvent | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageComment {
  id: string;
  postId: string;
  author: StageAuthor;
  body: string;
  status: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedPage {
  posts: StagePost[];
  nextCursor: string | null;
}

const base = '/stage';

export function fetchFeed(cursor?: string | null) {
  return apiGet<FeedPage>(`${base}/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
}

export function fetchAuthorPosts(type: StageAuthorType, id: string, cursor?: string | null) {
  return apiGet<FeedPage>(
    `${base}/authors/${type}/${encodeURIComponent(id)}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
}

export function fetchTagPosts(tag: string, cursor?: string | null) {
  return apiGet<FeedPage>(
    `${base}/tags/${encodeURIComponent(tag.replace(/^#/, ''))}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
}

export function fetchPost(id: string) {
  return apiGet<{ post: StagePost }>(`${base}/posts/${encodeURIComponent(id)}`);
}

export interface CreatePostPayload {
  kind?: PostKind;
  body?: string;
  media?: StageMedia[];
  linkUrl?: string | null;
  city?: string | null;
  genres?: string[];
  visibility?: 'public' | 'followers';
  sharedPortfolioItemId?: string;
  sharedJobId?: string;
  resharedPostId?: string;
}

export function createPost(payload: CreatePostPayload, actAsHeader?: Record<string, string>) {
  return apiPost<{ id: string; post: StagePost }>(`${base}/posts`, payload, { headers: actAsHeader });
}

export function updatePost(
  id: string,
  payload: Partial<Pick<CreatePostPayload, 'body' | 'linkUrl' | 'city' | 'genres' | 'visibility'>>,
) {
  return apiPatch<{ post: StagePost }>(`${base}/posts/${encodeURIComponent(id)}`, payload);
}

export function deletePost(id: string) {
  return apiDelete<{ ok: boolean }>(`${base}/posts/${encodeURIComponent(id)}`);
}

export function addApplause(postId: string, actAsHeader?: Record<string, string>) {
  return apiPost<{ ok: boolean; applauseCount: number }>(
    `${base}/posts/${encodeURIComponent(postId)}/applause`,
    undefined,
    {
      headers: actAsHeader,
    },
  );
}

export function removeApplause(postId: string) {
  return apiDelete<{ ok: boolean; applauseCount: number }>(`${base}/posts/${encodeURIComponent(postId)}/applause`);
}

export function fetchComments(postId: string) {
  return apiGet<{ comments: StageComment[] }>(`${base}/posts/${encodeURIComponent(postId)}/comments`);
}

export function addComment(postId: string, body: string, parentId?: string, actAsHeader?: Record<string, string>) {
  return apiPost<{ id: string; comment: StageComment }>(
    `${base}/posts/${encodeURIComponent(postId)}/comments`,
    { body, parentId },
    { headers: actAsHeader },
  );
}

export function deleteComment(commentId: string) {
  return apiDelete<{ ok: boolean }>(`${base}/comments/${encodeURIComponent(commentId)}`);
}

export function followActor(followableType: StageAuthorType, followableId: string) {
  return apiPost<{ ok: boolean; following: boolean }>(`${base}/follows`, { followableType, followableId });
}

export function unfollowActor(followableType: StageAuthorType, followableId: string) {
  return apiDelete<{ ok: boolean; following: boolean }>(
    `${base}/follows/${followableType}/${encodeURIComponent(followableId)}`,
  );
}

export function fetchFollowers(type: StageAuthorType, id: string) {
  return apiGet<{ followersCount: number; following: boolean }>(
    `${base}/authors/${type}/${encodeURIComponent(id)}/followers`,
  );
}

export function fetchFollowing(userId: string) {
  return apiGet<{ followingCount: number }>(`${base}/authors/user/${encodeURIComponent(userId)}/following`);
}

// ---- "Posting as" -------------------------------------------------------
// No app-wide acting-as switcher exists yet (see backend/app/controllers/concerns/acting_as.rb
// for the header it reads). This is a small, self-contained version scoped to the Stage: it
// lists the Pages (acts and organizations) the signed-in person runs, and remembers which one
// is active per person. Exported so another screen can adopt the same identity later.

export interface ActingAsOption extends StageAuthor {
  key: string; // "user:<id>" | "act:<id>" | "organization:<id>"
}

function actingAsStorageKey(userId: string) {
  return `verse_stage_acting_as:${userId}`;
}

export function useActingAsOptions() {
  const { user } = useAuth();
  const [options, setOptions] = useState<ActingAsOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const self: ActingAsOption = {
      key: `user:${user.id}`,
      type: 'user',
      id: user.id,
      name: user.name,
      verified: user.verified,
    };
    Promise.all([
      apiGet<{ acts?: Act[] }>('/acts/me').catch(() => ({ acts: [] })),
      apiGet<{ organizations?: Organization[] }>('/organizations').catch(() => ({ organizations: [] })),
    ]).then(([acts, orgs]) => {
      if (!alive) return;
      const actOptions: ActingAsOption[] = (acts.acts || []).map((a) => ({
        key: `act:${a.id}`,
        type: 'act',
        id: a.id,
        name: a.name,
      }));
      const orgOptions: ActingAsOption[] = (orgs.organizations || [])
        .filter((o) => o.memberRole === 'owner' || o.memberRole === 'admin')
        .map((o) => ({ key: `organization:${o.id}`, type: 'organization', id: o.id, name: o.name }));
      setOptions([self, ...actOptions, ...orgOptions]);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  return { options, loading };
}

export function useActingAs() {
  const { user } = useAuth();
  const { options, loading } = useActingAsOptions();
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    if (!user) return;
    try {
      setSelectedKey(localStorage.getItem(actingAsStorageKey(user.id)) || `user:${user.id}`);
    } catch {
      setSelectedKey(`user:${user.id}`);
    }
  }, [user]);

  const active = options.find((o) => o.key === selectedKey) || options[0];

  const setActive = useCallback(
    (key: string) => {
      setSelectedKey(key);
      if (user) {
        try {
          localStorage.setItem(actingAsStorageKey(user.id), key);
        } catch {
          /* per-viewer convenience only */
        }
      }
    },
    [user],
  );

  const header: Record<string, string> | undefined =
    active && active.type !== 'user' ? { 'X-Verse-Act-As': `${active.type}:${active.id}` } : undefined;

  return { active, options, loading, setActive, header };
}

/** True when `author` is the signed-in person, or the identity they're currently acting as. */
export function isOwnedByActor(author: StageAuthor, selfUserId: string | undefined, active?: StageAuthor) {
  if (author.type === 'user' && author.id === selfUserId) return true;
  return Boolean(active && author.type === active.type && author.id === active.id);
}

// ---- text helpers --------------------------------------------------------

const HASHTAG_PATTERN = /#(\w+)/g;

/**
 * Splits a post body into plain text and hashtag segments (hashtags become `/stage/tags/:tag`
 * links). URLs inside a "text" segment are left for `linkify()` (src/app/lib/linkify.tsx) to
 * render, so the Stage reuses the same safe http(s)-only link rendering as the rest of the app.
 */
export type TextSegment = { kind: 'text' | 'hashtag'; value: string };

export function splitHashtags(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  HASHTAG_PATTERN.lastIndex = 0;
  while ((match = HASHTAG_PATTERN.exec(body))) {
    if (match.index > lastIndex) segments.push({ kind: 'text', value: body.slice(lastIndex, match.index) });
    segments.push({ kind: 'hashtag', value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ kind: 'text', value: body.slice(lastIndex) });
  return segments;
}

/** A short "3h", "2d", "just now" label; falls back to a date past a week. */
export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const POST_KIND_LABEL: Record<PostKind, string> = {
  update: 'Update',
  performance: 'Performance',
  release: 'Release',
  gig: 'Gig',
  looking_for: 'Looking for',
  job_share: 'Job',
  portfolio_share: 'Portfolio',
  system: 'Verse',
  event: 'Event',
};

/** Pinned-and-current posts first (most recent pin first), everything else by recency — the same
 * order the feed API already returns; used when merging client-side (e.g. after Composer
 * prepends a fresh post) so a pinned post never gets bumped below it. */
export function sortPinnedFirst(posts: StagePost[]): StagePost[] {
  return [...posts].sort((a, b) => {
    const pinnedDiff = Number(b.pinned) - Number(a.pinned);
    if (pinnedDiff !== 0) return pinnedDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function fetchUpcomingEvents(city?: string | null) {
  return apiGet<{ city: string | null; events: StagePost[] }>(
    `${base}/events${city ? `?city=${encodeURIComponent(city)}` : ''}`,
  );
}

export function icsUrlFor(postId: string) {
  return `${API_BASE}${base}/posts/${encodeURIComponent(postId)}/ics`;
}

const YOUTUBE_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/i;
const INSTAGRAM_PATTERN = /instagram\.com\/(?:reel|p|tv)\/([\w-]+)/i;

export type EmbedPreview = { kind: 'youtube' | 'instagram'; embedUrl: string } | null;

/** A safe, allow-listed embed for a YouTube or Instagram link; null renders as a plain link instead. */
export function embedPreviewFor(url: string | null | undefined): EmbedPreview {
  if (!url) return null;
  const yt = url.match(YOUTUBE_PATTERN);
  if (yt) return { kind: 'youtube', embedUrl: `https://www.youtube.com/embed/${yt[1]}` };
  const ig = url.match(INSTAGRAM_PATTERN);
  if (ig) return { kind: 'instagram', embedUrl: `https://www.instagram.com/p/${ig[1]}/embed` };
  return null;
}

// Media rendered from a post keeps its image/audio URL only for uploads made in this browser
// session (the API never returns a URL alongside a stored post's media — only `uploadId`,
// `type` and `caption`, see backend/docs/api-stage-feed.md). This small session cache lets a
// person's own freshly-posted media render immediately; older or other people's media shows as
// a labelled attachment instead of a broken image.
const mediaUrlCache = new Map<string, string>();
export function rememberMediaUrl(uploadId: string, url: string) {
  mediaUrlCache.set(uploadId, url);
}
export function mediaUrlFor(uploadId: string): string | undefined {
  return mediaUrlCache.get(uploadId);
}

export function authorPath(author: StageAuthor) {
  return `/stage/authors/${author.type}/${encodeURIComponent(author.id)}`;
}
