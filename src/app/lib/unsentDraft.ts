import { useEffect, useRef } from 'react';
import { onBeforeSignInRedirect } from './api';

// Keeps text a person has typed but not sent across an expired-session redirect (api.ts signs
// them out and sends them to sign-in, then back to the page). A form registers a snapshot
// function while it is mounted; the expiry handler calls saveUnsentDrafts() just before it leaves
// the page; the form asks for its draft back with takeUnsentDraft() once the page loads again.
// sessionStorage only: the draft belongs to this tab and this visit and never outlives it.

const KEY = 'verse_unsent_drafts';
const sources = new Map<string, () => string>();

/** Registers a form's snapshot function under a stable `key`; returns the unregister function. */
export function registerUnsentDraft(key: string, read: () => string): () => void {
  sources.set(key, read);
  return () => {
    if (sources.get(key) === read) sources.delete(key);
  };
}

function readStore(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Stores every registered form's non-empty text. Best effort: a blocked store loses the draft only. */
export function saveUnsentDrafts() {
  const drafts: Record<string, string> = {};
  for (const [key, read] of sources) {
    const text = read();
    if (text.trim()) drafts[key] = text;
  }
  if (!Object.keys(drafts).length) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readStore(), ...drafts }));
  } catch {
    /* worst case the person retypes it */
  }
}

// Importing this module is what arms the hook: the expiry handler in api.ts keeps the drafts of every form
// that registered, just before it leaves the page.
onBeforeSignInRedirect(saveUnsentDrafts);

/** Returns and clears the saved draft for `key`, or null when there is none. */
export function takeUnsentDraft(key: string): string | null {
  const store = readStore();
  const text = store[key];
  if (typeof text !== 'string') return null;
  delete store[key];
  try {
    if (Object.keys(store).length) sessionStorage.setItem(KEY, JSON.stringify(store));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return text;
}

/**
 * For a controlled text field: keeps `value` readable by the expiry handler while mounted, and
 * calls `restore` once on mount with any draft saved before a forced sign-in. A no-op when
 * `enabled` is false (for instance a composer variant that never carries a draft).
 */
export function useUnsentDraft(key: string, value: string, restore: (text: string) => void, enabled = true) {
  const latest = useRef(value);
  latest.current = value;
  const onRestore = useRef(restore);
  onRestore.current = restore;
  useEffect(() => {
    if (!enabled) return;
    const saved = takeUnsentDraft(key);
    if (saved) onRestore.current(saved);
    return registerUnsentDraft(key, () => latest.current);
  }, [key, enabled]);
}
