import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { errorCode, errorMessage, errorStatus } from '../errors';

describe('errorMessage', () => {
  it('reads the message of an Error or ApiError', () => {
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage(new ApiError('Not allowed', 403), 'fallback')).toBe('Not allowed');
    expect(errorMessage({ message: 'plain object' })).toBe('plain object');
  });

  it('falls back when there is no usable message', () => {
    expect(errorMessage(new Error(''), 'Try again.')).toBe('Try again.');
    expect(errorMessage({ message: 42 }, 'Try again.')).toBe('Try again.');
    expect(errorMessage('a thrown string', 'Try again.')).toBe('Try again.');
    expect(errorMessage(null, 'Try again.')).toBe('Try again.');
    expect(errorMessage(undefined)).toBe('');
  });
});

describe('errorStatus', () => {
  it('reads the HTTP status of an ApiError-shaped value', () => {
    expect(errorStatus(new ApiError('Slow down', 429))).toBe(429);
    expect(errorStatus({ status: 404 })).toBe(404);
  });

  it('is undefined for anything else', () => {
    expect(errorStatus(new Error('network'))).toBeUndefined();
    expect(errorStatus({ status: '500' })).toBeUndefined();
    expect(errorStatus(null)).toBeUndefined();
  });
});

describe('errorCode', () => {
  it('reads the machine-readable code of an ApiError', () => {
    expect(errorCode(new ApiError('Blocked', 403, 'MESSAGING_BLOCKED'))).toBe('MESSAGING_BLOCKED');
  });

  it('is undefined when there is no string code', () => {
    expect(errorCode(new ApiError('Oops', 500))).toBeUndefined();
    expect(errorCode({ code: 7 })).toBeUndefined();
    expect(errorCode('nope')).toBeUndefined();
  });
});
