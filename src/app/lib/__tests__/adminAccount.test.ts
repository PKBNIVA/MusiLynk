import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from './helpers';
import type { AdminAccountHealth } from '../apiTypes';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

async function load() {
  vi.resetModules();
  return import('../adminAccount');
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

const call = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
};

describe('admin account calls', () => {
  it('reads the account health', async () => {
    const health: AdminAccountHealth = {
      email: 'ops@example.com',
      emailDeliverable: true,
      secondFactor: 'enforced',
      adminOrigin: true,
    };
    fetchMock.mockResolvedValue(jsonResponse(health));
    const { getAdminAccount } = await load();
    await expect(getAdminAccount()).resolves.toEqual(health);
    expect(call()).toMatchObject({ url: '/api/admin/account', method: 'GET' });
  });

  it('requests and confirms an email change, and changes the password', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ changeToken: 'tok', expiresIn: 600 }, 202))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'a', email: 'new@example.com' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { requestAdminEmailChange, confirmAdminEmailChange, changeAdminPassword } = await load();

    await expect(requestAdminEmailChange('new@example.com')).resolves.toEqual({ changeToken: 'tok', expiresIn: 600 });
    await confirmAdminEmailChange('tok', '123456');
    await changeAdminPassword('old-password', 'new-password-123');

    expect(call(0)).toEqual({
      url: '/api/admin/account/email/request',
      method: 'POST',
      body: { email: 'new@example.com' },
    });
    expect(call(1)).toEqual({
      url: '/api/admin/account/email/confirm',
      method: 'POST',
      body: { changeToken: 'tok', code: '123456' },
    });
    expect(call(2)).toEqual({
      url: '/api/admin/account/password',
      method: 'POST',
      body: { currentPassword: 'old-password', newPassword: 'new-password-123' },
    });
  });

  it('surfaces the API error code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'That address cannot receive email.', code: 'EMAIL_UNDELIVERABLE' }, 422),
    );
    const { requestAdminEmailChange } = await load();
    await expect(requestAdminEmailChange('ops@verse.local')).rejects.toMatchObject({
      status: 422,
      code: 'EMAIL_UNDELIVERABLE',
    });
  });
});

describe('secondFactorGap', () => {
  const base: AdminAccountHealth = {
    email: 'ops@example.com',
    emailDeliverable: true,
    secondFactor: 'enforced',
    adminOrigin: true,
  };

  it('is null only when the code is enforced and deliverable', async () => {
    const { secondFactorGap } = await load();
    expect(secondFactorGap(base)).toBeNull();
    expect(secondFactorGap({ ...base, emailDeliverable: false })).toBe('your admin email address cannot receive email');
    expect(secondFactorGap({ ...base, emailDeliverable: false, secondFactor: 'skipped' })).toBe(
      'your admin email address cannot receive email',
    );
    expect(secondFactorGap({ ...base, secondFactor: 'future' as AdminAccountHealth['secondFactor'] })).toBeNull();
    expect(secondFactorGap({ ...base, secondFactor: 'off' })).toBe('it is turned off on the server');
    expect(secondFactorGap({ ...base, secondFactor: 'unavailable' })).toBe('the server cannot send email right now');
    expect(secondFactorGap({ ...base, secondFactor: 'skipped' })).toBe('the sign-in code could not be emailed to you');
  });
});
