import { useEffect, useState } from 'react';
import { apiGet, apiPost } from './api';

/**
 * Client for the AI Assist layer (AiController on the backend). Every suggestion is exactly
 * that — a suggestion the person accepts, edits or discards. Nothing here ever sends anything
 * on the person's behalf.
 */

/** The fixed, server-defined task allow-list (AiAssist::Tasks::PUBLIC_TASKS). */
export type AiTask =
  | 'job_description'
  | 'job_screening_questions'
  | 'profile_headline'
  | 'profile_bio'
  | 'portfolio_blurb'
  | 'cover_letter'
  | 'post_caption'
  | 'message_reply'
  | 'resume_summary'
  | 'improve_text';

export type AutocompleteField = 'skills' | 'genres' | 'instruments' | 'roles' | 'cities';

export interface AiStatus {
  enabled: boolean;
  tasks: AiTask[];
}

export interface AiSuggestion {
  suggestion: string;
  task: string;
  model: string;
}

export interface AutocompleteSuggestion {
  value: string;
  /** "taxonomy" (always available) or "ai" (only added when AI is enabled and matches are thin). */
  source: 'taxonomy' | 'ai';
}

export interface AutocompleteResponse {
  field: string;
  query: string;
  suggestions: AutocompleteSuggestion[];
}

/** Structured context for a task. The client never sends a raw prompt — only these fields. */
export type AiContext = Record<string, string | string[] | undefined>;

let statusCache: Promise<AiStatus> | null = null;

/** Fetches AI Assist's on/off state once per page load (a failed fetch is retried next time). */
export function loadAiStatus(): Promise<AiStatus> {
  statusCache ||= apiGet<AiStatus>('/ai/status').catch((error: unknown) => {
    statusCache = null;
    throw error;
  });
  return statusCache;
}

/** For tests: forget the fetched status. */
export function resetAiStatus() {
  statusCache = null;
}

/**
 * AI Assist's current on/off state and task allow-list, cached for this session. `null` while
 * loading or if the status could not be fetched — components should treat that as "hide AI".
 */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    loadAiStatus()
      .then((value) => {
        if (live) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/** Whether AI Assist is on and offers `task` right now (used to hide Suggest/Improve buttons). */
export function useAiTaskEnabled(task: AiTask): boolean {
  const status = useAiStatus();
  return Boolean(status?.enabled && status.tasks.includes(task));
}

/** POST /api/ai/suggest — always a suggestion; the caller decides whether to use it. */
export function suggestAi(task: AiTask, context: AiContext, signal?: AbortSignal): Promise<AiSuggestion> {
  return apiPost<AiSuggestion>('/ai/suggest', { task, context }, { signal });
}

/**
 * GET /api/ai/autocomplete — works with no AI configured (taxonomy prefix/fuzzy match); adds
 * `source: "ai"` entries only when AI is enabled and taxonomy matches are thin.
 */
export function autocompleteAi(
  field: AutocompleteField,
  query: string,
  signal?: AbortSignal,
): Promise<AutocompleteResponse> {
  const params = new URLSearchParams({ field, q: query });
  return apiGet<AutocompleteResponse>(`/ai/autocomplete?${params.toString()}`, { signal });
}
