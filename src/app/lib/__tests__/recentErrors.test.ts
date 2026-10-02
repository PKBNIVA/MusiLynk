import { describe, expect, it } from 'vitest';
import { getRecentErrors, noteClientError, scrubMessage, watchClientErrors } from '../recentErrors';

describe('scrubMessage', () => {
  it('masks Basic credentials and key=value secrets but keeps the key name', () => {
    const out = scrubMessage('Basic dXNlcjpwYXNz failed, api-key=abc123 password=hunter2 ok=1');
    expect(out).toBe('Basic [removed] failed, api-key=[removed] password=[removed] ok=1');
  });

  it('collapses whitespace and trims', () => {
    expect(scrubMessage('  a \n\t b  ')).toBe('a b');
  });
});

describe('noteClientError', () => {
  it('keeps only the last 10, oldest dropped, scrubbed', () => {
    for (let i = 0; i < 12; i += 1) noteClientError(`error ${i} for me@example.com`);
    const errors = getRecentErrors();
    expect(errors).toHaveLength(10);
    expect(errors[0]).toBe('error 2 for [email]');
    expect(errors[9]).toBe('error 11 for [email]');
  });

  it('formats Error objects and ignores empty or non-text values', () => {
    const before = getRecentErrors().length;
    noteClientError(new TypeError('bad thing'));
    noteClientError('');
    noteClientError({ message: 'object' });
    noteClientError(undefined);
    const errors = getRecentErrors();
    expect(errors.at(-1)).toBe('TypeError: bad thing');
    expect(errors.length).toBe(Math.min(10, before + 1));
  });

  it('returns a copy', () => {
    getRecentErrors().push('mutated');
    expect(getRecentErrors()).not.toContain('mutated');
  });
});

describe('watchClientErrors', () => {
  it('notes uncaught errors and rejections until stopped', () => {
    const stop = watchClientErrors();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught one') }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'plain message' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = 'rejected reason';
    window.dispatchEvent(rejection);
    const seen = getRecentErrors();
    expect(seen).toContain('Error: uncaught one');
    expect(seen).toContain('plain message');
    expect(seen).toContain('rejected reason');
    stop();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after stop' }));
    expect(getRecentErrors()).not.toContain('after stop');
  });
});
