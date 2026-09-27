import { describe, expect, it } from 'vitest';
import { FILTERED, isSensitiveKey, scrubEvent, scrubString, scrubValue } from '../sentryScrub';

describe('scrubString', () => {
  it('removes auth headers, secrets in query strings and email addresses', () => {
    expect(scrubString('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${FILTERED}`);
    expect(scrubString('basic dXNlcjpwYXNz')).toBe(`basic ${FILTERED}`);
    expect(scrubString('/auth/verify?email=a%40b.co&code=123456&next=/jobs')).toBe(
      `/auth/verify?email=${FILTERED}&code=${FILTERED}&next=/jobs`,
    );
    expect(scrubString('GET /reset?reset_token=xyz#top')).toBe(`GET /reset?reset_token=${FILTERED}#top`);
    expect(scrubString('Contact jane.doe+band@example.co.uk now')).toBe('Contact [email] now');
    expect(scrubString('encoded jane%40example.com')).toBe('encoded [email]');
  });

  it('removes known secrets of eight or more characters wherever they appear', () => {
    expect(scrubString('failed for eyJhbGciOi token', ['eyJhbGciOi'])).toBe(`failed for ${FILTERED} token`);
    // Short or empty values are ignored so common words are not mangled.
    expect(scrubString('short abc', ['abc', ''])).toBe('short abc');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubString('Jobs page failed to render (TypeError)')).toBe('Jobs page failed to render (TypeError)');
  });
});

describe('isSensitiveKey', () => {
  it('flags credential and personal-data keys but not look-alikes', () => {
    for (const key of [
      'password',
      'passwd',
      'accessToken',
      'client_secret',
      'x-signature',
      'otp',
      'Authorization',
      'Cookie',
      'api_key',
      'accessKey',
      'credentials',
      'sessionId',
      'email',
      'code',
      'body',
      'dsn',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['statusCode', 'name', 'bodyType', 'role', 'url']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe('scrubValue', () => {
  it('scrubs nested objects and arrays, filtering sensitive keys', () => {
    const input = {
      user: { email: 'a@b.co', name: 'Asha' },
      list: ['ok', 'mail me at a@b.co'],
      headers: { authorization: 'Bearer x' },
      count: 3,
      nothing: null,
    };
    expect(scrubValue(input)).toEqual({
      user: { email: FILTERED, name: 'Asha' },
      list: ['ok', 'mail me at [email]'],
      headers: { authorization: FILTERED },
      count: 3,
      nothing: null,
    });
    // The input is not mutated.
    expect(input.user.email).toBe('a@b.co');
  });

  it('leaves class instances untouched and stops at a depth limit', () => {
    const date = new Date(0);
    expect(scrubValue({ at: date }).at).toBe(date);

    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 15; i += 1) deep = { next: deep };
    let cursor: unknown = scrubValue(deep);
    let depth = 0;
    while (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>).next;
      depth += 1;
    }
    expect(cursor).toBe(FILTERED);
    expect(depth).toBe(13);
  });
});

describe('scrubEvent', () => {
  it('keeps only id and role on the user and drops request cookies and body', () => {
    const event = {
      message: 'Failed for bob@example.com',
      user: { id: 'u1', role: 'employer', ip_address: '1.2.3.4', username: 'bob' },
      request: { url: 'https://verse.app/auth?code=999', cookies: 'a=b', data: '{"password":"x"}' },
    };
    const clean = scrubEvent(event, []);
    expect(clean.message).toBe('Failed for [email]');
    expect(clean.user).toEqual({ id: 'u1', role: 'employer' });
    expect(clean.request).toEqual({ url: `https://verse.app/auth?code=${FILTERED}` });
  });

  it('drops a user with neither id nor role and keeps partial users', () => {
    expect(scrubEvent({ user: { ip_address: '1.2.3.4' } }).user).toBeUndefined();
    expect(scrubEvent({ user: { id: 'u2' } }).user).toEqual({ id: 'u2' });
    expect(scrubEvent({ user: { role: 'admin' } }).user).toEqual({ role: 'admin' });
    expect(scrubEvent({ user: null, request: null })).toEqual({ user: null, request: null });
  });
});
