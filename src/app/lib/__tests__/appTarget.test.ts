import { describe, expect, it, vi } from 'vitest';

async function load(target?: 'admin' | 'public', publicUrl?: string) {
  vi.resetModules();
  if (target) vi.stubEnv('VITE_APP_TARGET', target);
  if (publicUrl !== undefined) vi.stubEnv('VITE_PUBLIC_URL', publicUrl);
  return import('../appTarget');
}

describe('build target', () => {
  it('defaults to the public site', async () => {
    const { IS_ADMIN_SITE, signInPath, PROTECTED_AREA } = await load();
    expect(IS_ADMIN_SITE).toBe(false);
    expect(signInPath('employer')).toBe('/auth/employer');
    expect(PROTECTED_AREA.test('/jobseeker/messages')).toBe(true);
    expect(PROTECTED_AREA.test('/admin')).toBe(false);
  });

  it('signs in at the root of the admin site and protects only admin pages', async () => {
    const { IS_ADMIN_SITE, signInPath, PROTECTED_AREA } = await load('admin');
    expect(IS_ADMIN_SITE).toBe(true);
    expect(signInPath('admin')).toBe('/');
    expect(PROTECTED_AREA.test('/admin/tester')).toBe(true);
    expect(PROTECTED_AREA.test('/account')).toBe(true);
    expect(PROTECTED_AREA.test('/employer')).toBe(false);
  });

  it('links absolute to the public site on the admin build, and relative everywhere else', async () => {
    const admin = await load('admin', 'https://verse.example.app/');
    expect(admin.toPublicUrl('/opportunities/1')).toBe('https://verse.example.app/opportunities/1');

    const publicSite = await load('public', 'https://verse.example.app');
    expect(publicSite.toPublicUrl('/opportunities/1')).toBe('/opportunities/1');

    const noConfig = await load('admin', '');
    expect(noConfig.toPublicUrl('/opportunities/1')).toBe('/opportunities/1');
  });
});
