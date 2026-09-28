import { useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from './api';

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
  | 'improve_text'
  | 'candidate_summary'
  | 'rank_applicants'
  | 'outreach_message'
  | 'interview_questions'
  | 'rejection_note'
  | 'draft_portfolio'
  | 'tailor_resume';

export type AutocompleteField = 'skills' | 'genres' | 'instruments' | 'roles' | 'cities';

export interface AiStatus {
  enabled: boolean;
  tasks: AiTask[];
}

export interface AiSuggestion {
  suggestion: string;
  task: string;
  model: string;
  cached?: boolean;
  creditsCharged?: number;
  balance?: number;
}

/** GET /api/ai/usage. */
export interface AiUsage {
  balance: number;
  monthlyAllowance: number | null;
  usedThisPeriod: number;
  resetsAt: string;
  plan: string;
  recent: { task: string; credits: number; date: string }[];
}

/** GET /api/ai/pricing — the public AI credits catalogue. */
export interface AiPricingCatalogue {
  freeCreditsPerMonth: number;
  aiPlus: { planCode: string; priceInr: number; creditsPerMonth: number };
  planAllowances: Record<string, number | null>;
  topups: Record<string, { priceInr: number; credits: number }>;
  topupExpiresAfterMonths: number;
  taskCosts: Record<string, number>;
}

/** What a 402 from /api/ai/suggest carries, offered by AiPaywallDialog. */
export interface AiUpgradeOptions {
  aiPlus: { planCode: string; priceInr: number; creditsPerMonth: number };
  topups: Record<string, { priceInr: number; credits: number }>;
}

/**
 * Thrown by `suggestAi` in place of a plain `ApiError` when the server refused the call for a
 * credits/spend reason (never for a validation or access error, which stay plain `ApiError`s).
 * `AI_CREDITS_EXHAUSTED` is the person's own balance; `AI_FREE_PAUSED` / `AI_HARD_PAUSED` are the
 * spend guard. `balance`/`resetsAt` come straight off the 402 body when the server sent them;
 * `upgradeOptions` is filled in from GET /api/ai/pricing so AiPaywallDialog always has an offer
 * to show even though the generic API client drops extra error-body fields.
 */
export class AiPaywallError extends Error {
  code: 'AI_CREDITS_EXHAUSTED' | 'AI_FREE_PAUSED' | 'AI_HARD_PAUSED';
  balance?: number;
  resetsAt?: string;
  upgradeOptions?: AiUpgradeOptions;

  constructor(
    message: string,
    code: AiPaywallError['code'],
    extra?: { balance?: number; resetsAt?: string; upgradeOptions?: AiUpgradeOptions },
  ) {
    super(message);
    this.name = 'AiPaywallError';
    this.code = code;
    this.balance = extra?.balance;
    this.resetsAt = extra?.resetsAt;
    this.upgradeOptions = extra?.upgradeOptions;
  }
}

const PAYWALL_CODES = new Set(['AI_CREDITS_EXHAUSTED', 'AI_FREE_PAUSED', 'AI_HARD_PAUSED']);

export function isAiPaywallError(error: unknown): error is AiPaywallError {
  return error instanceof AiPaywallError;
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
export function suggestAi(
  task: AiTask,
  context: AiContext,
  options?: { signal?: AbortSignal; regenerate?: boolean },
): Promise<AiSuggestion> {
  return apiPost<AiSuggestion>(
    '/ai/suggest',
    { task, context, regenerate: options?.regenerate },
    { signal: options?.signal },
  ).catch(async (error: unknown) => {
    if (error instanceof ApiError && error.status === 402 && error.code && PAYWALL_CODES.has(error.code)) {
      const upgradeOptions = await loadAiPricing()
        .then((pricing) => ({ aiPlus: pricing.aiPlus, topups: pricing.topups }))
        .catch(() => undefined);
      throw new AiPaywallError(error.message, error.code as AiPaywallError['code'], { upgradeOptions });
    }
    throw error;
  });
}

/** GET /api/ai/usage — the signed-in account's credits balance, allowance and recent activity. */
export function loadAiUsage(signal?: AbortSignal): Promise<AiUsage> {
  return apiGet<AiUsage>('/ai/usage', { signal });
}

let pricingCache: Promise<AiPricingCatalogue> | null = null;

/** GET /api/ai/pricing — the public catalogue, cached for this session. */
export function loadAiPricing(signal?: AbortSignal): Promise<AiPricingCatalogue> {
  pricingCache ||= apiGet<AiPricingCatalogue>('/ai/pricing', { signal }).catch((error: unknown) => {
    pricingCache = null;
    throw error;
  });
  return pricingCache;
}

/** For tests: forget the fetched pricing catalogue. */
export function resetAiPricing() {
  pricingCache = null;
}

/** The signed-in account's AI credits, refetched on demand (used by AiCreditsBadge). */
export function useAiUsage(): { usage: AiUsage | null; reload: () => void } {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    loadAiUsage()
      .then((value) => {
        if (live) setUsage(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [generation]);
  return { usage, reload: () => setGeneration((n) => n + 1) };
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
