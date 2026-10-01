import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { errorCode, errorMessage, errorStatus, requestFailedMessage, withNextStep } from '../errors';

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

describe('withNextStep', () => {
  it('adds a next step to a failure that has none', () => {
    expect(withNextStep('Unable to send your message.')).toBe('Unable to send your message. Try again.');
    expect(withNextStep('Your profile could not be loaded')).toBe('Your profile could not be loaded. Try again.');
  });

  it('leaves messages that already say what to do, and messages that are not failures', () => {
    expect(withNextStep('Upload failed. Try again.')).toBe('Upload failed. Try again.');
    expect(withNextStep('That link can’t be used. Choose another.')).toBe('That link can’t be used. Choose another.');
    expect(withNextStep('Saved.')).toBe('Saved.');
    expect(withNextStep('')).toBe('');
  });

  it('is applied to fallbacks only, never to what the server said', () => {
    expect(errorMessage(null, 'Unable to load notifications.')).toBe('Unable to load notifications. Try again.');
    expect(errorMessage(new Error('Unable to do it.'), 'x')).toBe('Unable to do it.');
  });
});

describe('requestFailedMessage', () => {
  it('never prints a bare status code', () => {
    expect(requestFailedMessage(503)).toBe('Something went wrong on our side. Try again in a moment.');
    expect(requestFailedMessage(409)).toBe('That did not go through. Check what you entered and try again.');
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
