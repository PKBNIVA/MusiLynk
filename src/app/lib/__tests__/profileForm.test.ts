import { beforeEach, describe, expect, it } from 'vitest';
import { blockStorage } from './helpers';
import {
  forgetPendingVerification,
  normalizeWebAddress,
  pendingVerificationSince,
  rememberPendingVerification,
} from '../profileForm';

describe('normalizeWebAddress', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  www.example.com/showreel?x=1 ', 'https://www.example.com/showreel?x=1'],
    ['//example.com', 'https://example.com'],
    ['youtube.com/@asha', 'https://youtube.com/@asha'],
  ])('adds https:// to %s', (raw, expected) => {
    expect(normalizeWebAddress(raw)).toBe(expected);
  });

  it.each(['https://example.com', 'http://example.com', 'javascript:alert(1)', 'mailto:a@b.co'])(
    'leaves %s for the validator',
    (raw) => {
      expect(normalizeWebAddress(raw)).toBe(raw);
    },
  );

  it.each(['not a url', 'abc', 'localhost'])('leaves %s alone so it still fails validation', (raw) => {
    expect(normalizeWebAddress(raw)).toBe(raw);
  });

  it('turns blank into blank', () => {
    expect(normalizeWebAddress('   ')).toBe('');
  });
});

describe('pending verification', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a request for 30 days, per person', () => {
    const sent = new Date('2026-10-01T09:00:00Z');
    rememberPendingVerification('u1', sent);
    expect(pendingVerificationSince('u1', sent.getTime() + 86_400_000)).toBe(sent.toISOString());
    expect(pendingVerificationSince('u2', sent.getTime())).toBeNull();
    expect(pendingVerificationSince('u1', sent.getTime() + 31 * 86_400_000)).toBeNull();
  });

  it('forgets on request', () => {
    rememberPendingVerification('u1');
    forgetPendingVerification('u1');
    expect(pendingVerificationSince('u1')).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const restore = blockStorage('localStorage');
    try {
      expect(() => rememberPendingVerification('u1')).not.toThrow();
      expect(pendingVerificationSince('u1')).toBeNull();
      expect(() => forgetPendingVerification('u1')).not.toThrow();
    } finally {
      restore();
    }
  });
});
