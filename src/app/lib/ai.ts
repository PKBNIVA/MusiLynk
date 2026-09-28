import { useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from './api';
import { openRazorpayCheckout, type RazorpayCheckoutConfig } from './razorpayCheckout';

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

/**
 * GET /api/ai/usage — how much of the account's own free AI help is left, for the small hint
 * next to the AI buttons. `period` is "lifetime" for talent tasks (profile_headline,
 * profile_bio) or "month" for hirer tasks (job_description, job_screening_questions); there is
 * no "credits" balance shown to the person.
 */
export interface AiUsage {
  remaining: number;
  limit: number;
  period: 'lifetime' | 'month';
}

/** GET /api/ai/pricing — the public AI pricing catalogue. `aiPlus`/`topups` are present only
 * while AI billing is enabled server-side (it stays off at launch — nothing is purchasable). */
export interface AiPricingCatalogue {
  freeCreditsPerMonth: number;
  planAllowances: Record<string, number | null>;
  taskCosts: Record<string, number>;
  aiPlus?: { planCode: string; priceInr: number; creditsPerMonth: number };
  topups?: Record<string, { priceInr: number; credits: number }>;
  topupExpiresAfterMonths?: number;
}

/**
 * Thrown by `suggestAi` in place of a plain `ApiError` when the server refused the call because
 * the account's own free AI help is used up (`AI_USAGE_LIMIT_REACHED`) or the platform-wide
 * monthly AI budget is resting (`AI_FREE_PAUSED`) — never for a validation or access error, which
 * stay plain `ApiError`s. The generic API client drops the extra fields a 402 body carries, so
 * `remaining`/`limit`/`period` are refetched from GET /api/ai/usage, best-effort, so
 * AiPaywallDialog can say how much (if anything) is left. A failed refetch still surfaces the
 * paywall, just without those numbers.
 */
export class AiPaywallError extends Error {
  code: 'AI_USAGE_LIMIT_REACHED' | 'AI_FREE_PAUSED';
  remaining?: number;
  limit?: number;
  period?: AiUsage['period'];

  constructor(
    message: string,
    code: AiPaywallError['code'],
    extra?: { remaining?: number; limit?: number; period?: AiUsage['period'] },
  ) {
    super(message);
    this.name = 'AiPaywallError';
    this.code = code;
    this.remaining = extra?.remaining;
    this.limit = extra?.limit;
    this.period = extra?.period;
  }
}

const PAYWALL_CODES = new Set(['AI_USAGE_LIMIT_REACHED', 'AI_FREE_PAUSED']);

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
      // The generic API client drops extra 402-body fields, so remaining/limit/period are
      // refetched from GET /api/ai/usage — the same numbers the hint next to the button shows.
      const usage = await loadAiUsage().catch(() => undefined);
      throw new AiPaywallError(error.message, error.code as AiPaywallError['code'], {
        remaining: usage?.remaining,
        limit: usage?.limit,
        period: usage?.period,
      });
    }
    throw error;
  });
}

/** GET /api/ai/usage — how much of the signed-in account's own free AI help is left. */
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

/** How much of the signed-in account's own free AI help is left, refetched on demand (used by
 * the AiCreditsBadge hint). */
export function useAiUsage(): { usage: AiUsage | null; reload: () => void } {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    loadAiUsage()
      .then((value) => {
        // Guards against an unmocked/misbehaving endpoint answering with an incomplete body.
        if (live && value && typeof value.remaining === 'number' && typeof value.limit === 'number') setUsage(value);
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

type PurchaseCheckout = { checkout: RazorpayCheckoutConfig | { mode: 'mock' } };

/**
 * Buys an AI credits top-up pack via Ai::BillingController, opening Razorpay checkout when the
 * server hands one back. Answers `503 AI_BILLING_DISABLED` until AI_BILLING_ENABLED is set, so
 * callers should treat a thrown ApiError with that code as "not offered yet" rather than a bug.
 */
export async function purchaseAiTopup(pack: string): Promise<void> {
  const d = await apiPost<PurchaseCheckout>('/ai/topups', { pack });
  if (d.checkout.mode === 'razorpay') {
    const result = await openRazorpayCheckout(d.checkout, { description: 'Verse AI credits top-up' });
    if (result.status !== 'success') throw new Error(result.lastError || 'Checkout was closed.');
  }
}

/** Subscribes the signed-in account to Verse AI Plus (independent of the hiring/talent plan). */
export async function subscribeAiPlus(): Promise<void> {
  const d = await apiPost<PurchaseCheckout>('/ai/plus/subscribe', {});
  if (d.checkout.mode === 'razorpay') {
    const result = await openRazorpayCheckout(d.checkout, { description: 'Verse AI Plus' });
    if (result.status !== 'success') throw new Error(result.lastError || 'Checkout was closed.');
  }
}
