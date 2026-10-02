import { describe, expect, it } from 'vitest';
import {
  buildProblemReportForm,
  checkScreenshot,
  describeBrowser,
  describeOs,
  sanitizePageUrl,
  SCREENSHOT_MAX_BYTES,
} from '../problemReport';
import { scrubMessage } from '../recentErrors';

describe('sanitizePageUrl', () => {
  it('keeps the path and harmless parameters', () => {
    expect(sanitizePageUrl('/jobseeker/profile?tab=security&city=Mumbai')).toBe(
      '/jobseeker/profile?tab=security&city=Mumbai',
    );
  });

  it('drops token, code, t and other secret parameters and the fragment', () => {
    expect(sanitizePageUrl('/reset-password?token=abc&tab=x#top')).toBe('/reset-password?tab=x');
    expect(sanitizePageUrl('/urgent/action?t=eyJ&city=Pune')).toBe('/urgent/action?city=Pune');
    expect(sanitizePageUrl('/auth/callback?code=1&state=2&auth=google')).toBe('/auth/callback');
    expect(sanitizePageUrl('/join?vouch=vch_1&email=a%40b.in&ref=friend')).toBe('/join?ref=friend');
  });

  it('replaces credential-looking path segments but keeps Verse record ids', () => {
    expect(sanitizePageUrl(`/x/${'a1'.repeat(20)}/y`)).toBe('/x/:token/y');
    expect(sanitizePageUrl('/opportunities/job_0f8e6c1a-2b4d-4c7e-9a31-5d6e7f8a9b0c')).toBe(
      '/opportunities/job_0f8e6c1a-2b4d-4c7e-9a31-5d6e7f8a9b0c',
    );
  });

  it('never keeps a host', () => {
    expect(sanitizePageUrl('https://verse.example/pricing?token=1')).toBe('/pricing');
  });
});

describe('scrubMessage', () => {
  it('removes emails, bearer tokens and secret values', () => {
    const out = scrubMessage('Failed for asha@example.com with Bearer abc.def and ?token=xyz123 &code=99');
    expect(out).not.toMatch(/asha@|abc\.def|xyz123|=99/);
    expect(out).toContain('[email]');
  });

  it('is short', () => {
    expect(scrubMessage('x'.repeat(1000)).length).toBe(200);
  });
});

describe('checkScreenshot', () => {
  it('accepts PNG, JPEG and WebP within the limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp'])
      expect(checkScreenshot({ type, size: 1000 })).toEqual({ ok: true });
  });

  it('refuses other types, empty files and files over the limit', () => {
    expect(checkScreenshot({ type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(checkScreenshot({ type: 'application/pdf', size: 10 }).ok).toBe(false);
    expect(checkScreenshot({ type: 'image/png', size: 0 }).ok).toBe(false);
    expect(checkScreenshot({ type: 'image/png', size: SCREENSHOT_MAX_BYTES + 1 }).ok).toBe(false);
  });
});

describe('device description', () => {
  it('names the browser and OS coarsely', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    expect(describeBrowser(ua)).toBe('Chrome 130');
    expect(describeOs(ua)).toBe('Android 14');
  });
});

describe('buildProblemReportForm', () => {
  const context = {
    page: '/pricing',
    release: 'r1',
    browser: 'Chrome 130',
    os: 'Linux',
    viewport: { width: 1280, height: 800 },
    errors: ['boom'],
  };

  it('sends the page and the allow-listed context only when it is included', () => {
    const form = buildProblemReportForm({ description: ' It broke ', expected: '', context });
    expect(form.get('description')).toBe('It broke');
    expect(form.get('page')).toBe('/pricing');
    expect(form.get('includeContext')).toBe('true');
    expect(JSON.parse(String(form.get('context')))).toEqual({
      release: 'r1',
      browser: 'Chrome 130',
      os: 'Linux',
      viewport: { width: 1280, height: 800 },
      errors: ['boom'],
    });
    expect(form.has('expected')).toBe(false);
    expect(form.has('email')).toBe(false);
  });

  it('sends no page or context when it is left out', () => {
    const form = buildProblemReportForm({ description: 'x', expected: 'y', context: null, email: 'a@b.co' });
    expect(form.get('includeContext')).toBe('false');
    expect(form.has('page')).toBe(false);
    expect(form.has('context')).toBe(false);
    expect(form.get('email')).toBe('a@b.co');
  });
});
