// Keeps a signed-out hirer's "need someone by tomorrow" draft across the sign-up hop: /urgent
// saves it here, sends them to /auth/employer?mode=register, and AuthPage submits it once
// they're signed in. sessionStorage only (never localStorage): the draft is scoped to this tab
// and this visit, and it's never meant to outlive the browsing session.
const KEY = 'verse_urgent_draft';

export interface UrgentDraft {
  title: string;
  roleName: string;
  city: string;
  venue?: string;
  startAt: string;
  budgetMin?: string;
  budgetMax?: string;
  note?: string;
  genres?: string[];
}

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
