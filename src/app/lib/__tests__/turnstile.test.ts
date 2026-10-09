import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNSTILE_SCRIPT, loadTurnstile, resetTurnstileLoader, turnstileSiteKey } from '../turnstile';

const api = { render: vi.fn(() => 'w1'), remove: vi.fn(), reset: vi.fn() };

beforeEach(() => {
  resetTurnstileLoader();
  delete window.turnstile;
  document.head.innerHTML = '';
});
afterEach(() => {
  delete window.turnstile;
});

describe('turnstileSiteKey', () => {
  it('is null when the build has no key or a blank one', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(turnstileSiteKey()).toBeNull();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '   ');
    expect(turnstileSiteKey()).toBeNull();
  });
  it('is the trimmed key when set', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ' 0x4AAA ');
    expect(turnstileSiteKey()).toBe('0x4AAA');
  });
});

describe('loadTurnstile', () => {
  it('reuses an API that is already on the page without adding a script', async () => {
    window.turnstile = api;
    await expect(loadTurnstile()).resolves.toBe(api);
    expect(document.querySelector('script')).toBeNull();
  });

  it('injects the Cloudflare script once and resolves when it loads', async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    const scripts = document.querySelectorAll<HTMLScriptElement>('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(TURNSTILE_SCRIPT);
    expect(scripts[0].async).toBe(true);
    window.turnstile = api;
    scripts[0].dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('rejects when the script loads without exposing the API', async () => {
    const pending = loadTurnstile();
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await expect(pending).rejects.toThrow(/without its API/);
  });

  it('rejects when the script fails to load, and a later call tries again', async () => {
    const pending = loadTurnstile();
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow(/failed to load/);
    const retry = loadTurnstile();
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(1); // the existing tag is reused, not duplicated
    window.turnstile = api;
    scripts[0].dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(api);
  });
});
