// Keeps a signed-out hirer's "need someone by tomorrow" draft across the sign-up hop: /urgent
// saves it here and sends them to /join/hiring; the join flow (new account) or the sign-in page
// (existing account) then calls submitUrgentDraft() once they're signed in. sessionStorage only (never localStorage): the draft is scoped to this tab
// and this visit, and it's never meant to outlive the browsing session.
import { apiPost } from './api';
import type { UrgentRequestBody } from './urgentForm';

const KEY = 'musilynk_urgent_draft';

/** The request body itself: the form validated before the hop, so it is posted as it was. */
export type UrgentDraft = UrgentRequestBody;

export function saveUrgentDraft(draft: UrgentDraft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* best effort: worst case the person re-enters the form after signing up */
  }
}

/** Returns and clears the saved draft, or null if there isn't one. */
export function consumeUrgentDraft(): UrgentDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as UrgentDraft) : null;
  } catch {
    return null;
  }
}

export interface UrgentConfirmation {
  id: string;
  notifiedCount: number;
  matchStatus?: string;
  responseTimePromise: string;
}

/**
 * Submits the saved draft, if there is one, now that the person is signed in. Returns the
 * confirmation for the /urgent status card, or null when nothing was saved. Throws on API errors
 * (the draft is cleared first, so a failed submit is retried from the form, not replayed).
 */
export async function submitUrgentDraft(): Promise<UrgentConfirmation | null> {
  const draft = consumeUrgentDraft();
  if (!draft) return null;
  const d = await apiPost<UrgentConfirmation>('/urgent-requests', draft);
  return {
    id: d.id,
    notifiedCount: d.notifiedCount,
    matchStatus: d.matchStatus,
    responseTimePromise: d.responseTimePromise,
  };
}
