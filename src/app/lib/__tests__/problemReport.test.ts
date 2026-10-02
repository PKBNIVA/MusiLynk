import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildProblemReportForm,
  canCaptureScreen,
  captureScreen,
  checkScreenshot,
  collectContext,
  DESCRIPTION_MAX,
  EXPECTED_MAX,
  fitScreenshot,
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

  it('replaces credential-looking path segments but keeps MusiLynk record ids', () => {
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

describe('describeBrowser and describeOs variants', () => {
  it('maps the common browsers', () => {
    expect(describeBrowser('Mozilla/5.0 Chrome/130.0 Safari/537 Edg/129.0')).toBe('Edge 129');
    expect(describeBrowser('Mozilla/5.0 (iPhone) Version/17.1 Mobile Safari/604')).toBe('Safari 17');
    expect(describeBrowser('Mozilla/5.0 Gecko/20100101 Firefox/131.0')).toBe('Firefox 131');
    expect(describeBrowser('Mozilla/5.0 (iPhone) CriOS/130 Mobile')).toBe('Chrome 130');
    expect(describeBrowser('Mozilla/5.0 SamsungBrowser/24.0 Chrome/115')).toBe('Samsung Internet 24');
    expect(describeBrowser('Mozilla/5.0 Safari/605')).toBe('Safari 605');
    expect(describeBrowser('curl/8')).toBe('Unknown browser');
  });
  it('maps the operating systems', () => {
    expect(describeOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)')).toBe('iOS 17');
    expect(describeOs('Mozilla/5.0 (Windows NT 10.0; Win64)')).toBe('Windows');
    expect(describeOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)')).toBe('macOS');
    expect(describeOs('Mozilla/5.0 (X11; CrOS x86_64)')).toBe('ChromeOS');
    expect(describeOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(describeOs('something')).toBe('Unknown device');
  });
});

describe('sanitizePageUrl edge cases', () => {
  it('caps the number of parameters and the length', () => {
    const many = Array.from({ length: 12 }, (_, i) => `p${i}=${i}`).join('&');
    expect(sanitizePageUrl(`/a?${many}`).split('&')).toHaveLength(8);
    expect(sanitizePageUrl(`/${'a'.repeat(400)}`)).toHaveLength(300);
  });
  it('falls back to / for an unparseable address', () => {
    expect(sanitizePageUrl('http://[bad')).toBe('/');
  });
});

describe('collectContext', () => {
  it('describes the page, device and viewport with the given errors', () => {
    window.history.pushState({}, '', '/pricing?token=abc&plan=pro');
    const context = collectContext(['boom']);
    expect(context.page).toBe('/pricing?plan=pro');
    expect(context.errors).toEqual(['boom']);
    expect(context.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(context.release).toBeTruthy();
    expect(typeof context.browser).toBe('string');
    expect(typeof context.os).toBe('string');
  });
  it('falls back to the global release marker', () => {
    (window as Window & { __VERSE_RELEASE__?: string }).__VERSE_RELEASE__ = 'abc123';
    expect(collectContext([]).release).toBeTruthy();
    delete (window as Window & { __VERSE_RELEASE__?: string }).__VERSE_RELEASE__;
  });
});

describe('buildProblemReportForm limits', () => {
  it('trims, caps lengths and includes screenshot, email and honeypot', () => {
    const screenshot = new File(['x'], 'shot.png', { type: 'image/png' });
    const form = buildProblemReportForm({
      description: 'd'.repeat(DESCRIPTION_MAX + 50),
      expected: ` ${'e'.repeat(EXPECTED_MAX + 50)} `,
      email: ' a@b.co ',
      screenshot,
      honeypot: 'spam',
      context: null,
    });
    expect(String(form.get('description'))).toHaveLength(DESCRIPTION_MAX);
    expect(String(form.get('expected'))).toHaveLength(EXPECTED_MAX);
    expect(form.get('email')).toBe('a@b.co');
    expect((form.get('screenshot') as File).name).toBe('shot.png');
    expect(form.get('website')).toBe('spam');
  });
});

describe('screen capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  it('reports whether the browser can capture', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    expect(canCaptureScreen()).toBe(false);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: vi.fn() } });
    expect(canCaptureScreen()).toBe(true);
  });

  it('returns null when the person cancels and rethrows other failures', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } });
    expect(await captureScreen()).toBeNull();
    getDisplayMedia.mockRejectedValueOnce(new DOMException('gone', 'AbortError'));
    expect(await captureScreen()).toBeNull();
    getDisplayMedia.mockRejectedValueOnce(new Error('broken'));
    await expect(captureScreen()).rejects.toThrow('broken');
    getDisplayMedia.mockRejectedValueOnce(new DOMException('x', 'NotFoundError'));
    await expect(captureScreen()).rejects.toThrow('x');
  });

  it('captures a frame as a JPEG and stops the tracks', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
      cb(new Blob(['jpg'], { type: 'image/jpeg' })),
    );
    const pending = captureScreen();
    await vi.advanceTimersByTimeAsync(300);
    const file = await pending;
    expect(file?.name).toBe('page.jpg');
    expect(file?.type).toBe('image/jpeg');
    expect(stop).toHaveBeenCalled();
  });

  it('returns null when the canvas cannot encode', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    const pending = captureScreen();
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBeNull();
    expect(stop).toHaveBeenCalled();
  });
});

describe('fitScreenshot', () => {
  const big = (type = 'image/png') => new File([new Uint8Array(SCREENSHOT_MAX_BYTES + 10)], 'big.png', { type });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  });

  it('returns files that already fit or are not shrinkable images', async () => {
    const small = new File(['x'], 's.png', { type: 'image/png' });
    expect(await fitScreenshot(small)).toBe(small);
    const pdf = big('application/pdf');
    expect(await fitScreenshot(pdf)).toBe(pdf);
  });

  it('shrinks a large image to a smaller JPEG', async () => {
    (globalThis as Record<string, unknown>).createImageBitmap = vi
      .fn()
      .mockResolvedValue({ width: 4000, height: 3000 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
      cb(new Blob(['small'], { type: 'image/jpeg' })),
    );
    const out = await fitScreenshot(big());
    expect(out.name).toBe('screenshot.jpg');
    expect(out.type).toBe('image/jpeg');
  });

  it('keeps the original when shrinking fails or does not help', async () => {
    const original = big();
    (globalThis as Record<string, unknown>).createImageBitmap = vi.fn().mockRejectedValue(new Error('decode'));
    expect(await fitScreenshot(original)).toBe(original);
    (globalThis as Record<string, unknown>).createImageBitmap = vi.fn().mockResolvedValue({ width: 10, height: 10 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    expect(await fitScreenshot(original)).toBe(original);
  });
});
