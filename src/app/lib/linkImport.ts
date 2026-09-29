import { apiPost } from './api';
import type { LinkPreview } from './onboarding';
import type { PortfolioItem } from './apiTypes';

// Link import: drafting a profile from pasted links (POST /api/link-import/draft) and, once
// reviewed, applying it — either as part of the two-minute sign-up (Onboarding::Starter) or
// straight into an existing account's library (POST /api/library/import).

export interface DraftCredit {
  text: string;
  source_url: string;
}

export interface DraftItem {
  url: string;
  title: string | null;
  caption: string | null;
}

export interface ProfileDraft {
  headline: string | null;
  bio: string | null;
  roles: string[];
  genres: string[];
  instruments: string[];
  city: string | null;
  yearsExperience: number | null;
  credits: DraftCredit[];
  items: DraftItem[];
}

// A resolved link: LinkPreview's shape widened to LinkImport::Resolver's extra kinds (a YouTube
// channel, a Spotify artist/track/album, a link-in-bio page and its expanded links, or any other
// scraped page) — plus optionally its own expanded links, one level, for a link-in-bio source.
export type DraftSource = Omit<LinkPreview, 'kind'> & { kind: string; links?: DraftSource[] };

export interface DraftResult {
  sources: DraftSource[];
  draft: ProfileDraft;
  aiUsed: boolean;
  provenance: Record<string, string>;
}

export const draftFromLinks = (links: string[]) =>
  apiPost<DraftResult>('/link-import/draft', { links }, { skipAuthRedirect: true, timeoutMs: 20_000 });

export interface LibraryImportResult {
  portfolioItems: PortfolioItem[];
  suggestedReview: { id: string } | null;
}

export const importDraftToLibrary = (draft: ProfileDraft) => apiPost<LibraryImportResult>('/library/import', draft);

/** The provider label a provenance source_url traces back to, for the review card's source chips. */
export function sourceLabel(sourceUrl: string | undefined, sources: DraftSource[]): string | null {
  if (!sourceUrl) return null;
  const source = sources.find((candidate) => candidate.url === sourceUrl);
  if (source?.label) return source.label;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
