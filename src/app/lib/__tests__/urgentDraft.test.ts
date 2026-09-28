import { beforeEach, describe, expect, it } from 'vitest';
import { blockStorage } from './helpers';
import { consumeUrgentDraft, saveUrgentDraft, type UrgentDraft } from '../urgentDraft';

const draft: UrgentDraft = {
  title: 'Drummer needed in Mumbai',
  roleName: 'Drummer',
  city: 'Mumbai',
  startAt: '2026-10-01T18:00:00.000Z',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('urgentDraft', () => {
  it('round-trips a saved draft and clears it on consume', () => {
    saveUrgentDraft(draft);
    expect(consumeUrgentDraft()).toEqual(draft);
    expect(sessionStorage.getItem('verse_urgent_draft')).toBeNull();
    expect(consumeUrgentDraft()).toBeNull();
  });

  it('returns null when nothing was saved', () => {
    expect(consumeUrgentDraft()).toBeNull();
  });

  it('returns null for corrupted JSON without throwing', () => {
    sessionStorage.setItem('verse_urgent_draft', 'not-json{');
    expect(consumeUrgentDraft()).toBeNull();
  });

  it('returns null for valid JSON that is not an object', () => {
    sessionStorage.setItem('verse_urgent_draft', '"just a string"');
    expect(consumeUrgentDraft()).toBeNull();
    sessionStorage.setItem('verse_urgent_draft', '42');
    expect(consumeUrgentDraft()).toBeNull();
  });

  it('saveUrgentDraft never throws when sessionStorage is blocked', () => {
    const restore = blockStorage('sessionStorage');
    try {
      expect(() => saveUrgentDraft(draft)).not.toThrow();
    } finally {
      restore();
    }
  });

  it('consumeUrgentDraft returns null when sessionStorage is blocked', () => {
    const restore = blockStorage('sessionStorage');
    try {
      expect(consumeUrgentDraft()).toBeNull();
    } finally {
      restore();
    }
  });
});
