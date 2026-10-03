import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HealthTab, { checkDetails, checkLabel, orderChecks, type AdminHealth, type HealthCheck } from '../HealthTab';
import { apiGet, ApiError } from '../../../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  apiGet: vi.fn(),
}));

const report: AdminHealth = {
  ok: true,
  service: 'musilynk-api',
  release: 'abc123def456',
  time: '2026-10-03T12:00:00Z',
  environment: 'production',
  coreReady: true,
  optionalIntegrationsReady: false,
  checks: {
    database: { ok: true, required: true, engine: 'postgresql' },
    frontendUrl: { ok: true, required: true },
    storage: { ok: true, required: false, uploadMethod: 'put' },
    razorpay: { ok: false, required: false, problems: ['missing_key'] },
    email: { ok: true, required: false, provider: 'brevo' },
  },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(apiGet).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = async () => {
  await act(async () => {
    root.render(<HealthTab />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('HealthTab helpers', () => {
  it('labels checks from their camelCase keys', () => {
    expect(checkLabel('database')).toBe('Database');
    expect(checkLabel('frontendUrl')).toBe('Frontend URL');
    expect(checkLabel('razorpayWebhook')).toBe('Razorpay webhook');
  });
  it('summarises a check without its ok/required flags and joins lists', () => {
    const check: HealthCheck = {
      ok: false,
      required: false,
      problems: ['missing_key', 'insecure'],
      note: null,
      provider: 'x',
    };
    expect(checkDetails(check)).toBe('problems: missing_key, insecure · provider: x');
    expect(checkDetails({ ok: true, required: true })).toBe('');
  });
  it('orders required checks first, failing before passing, then by name', () => {
    expect(orderChecks(report.checks).map(([key]) => key)).toEqual([
      'database',
      'frontendUrl',
      'razorpay',
      'email',
      'storage',
    ]);
  });
});

describe('HealthTab', () => {
  it('reads GET /admin/health once and renders the release, the readiness badges and every check', async () => {
    vi.mocked(apiGet).mockResolvedValue(report);
    await show();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/admin/health');
    expect(host.querySelector('[data-testid=health-core]')?.textContent).toBe('Core ready');
    expect(host.querySelector('[data-testid=health-optional]')?.textContent).toBe('Some integrations off');
    expect(host.querySelector('[data-testid=health-release]')?.textContent).toContain('abc123def456');
    expect(host.querySelector('[data-testid=health-release]')?.textContent).toContain('production');
    expect(host.querySelectorAll('[data-testid^=health-check-]')).toHaveLength(5);
    const razorpay = host.querySelector('[data-testid=health-check-razorpay]')!;
    expect(razorpay.textContent).toContain('Razorpay');
    expect(razorpay.textContent).toContain('Off');
    expect(razorpay.textContent).toContain('optional');
    expect(razorpay.textContent).toContain('problems: missing_key');
    expect(host.querySelector('[data-testid=health-check-database]')?.textContent).toContain('OK');
  });

  it('says the API is not ready on a 503 and offers a retry that reads again', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError('Service Unavailable', 503)).mockResolvedValueOnce(report);
    await show();
    expect(host.textContent).toContain('not ready (503)');
    const retry = [...host.querySelectorAll('button')].find((b) => /retry|try again/i.test(b.textContent || ''));
    expect(retry, 'a retry button').toBeTruthy();
    await act(async () => {
      retry!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid=health-core]')?.textContent).toBe('Core ready');
  });

  it('shows the failure message for any other error', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError('Authentication required', 401));
    await show();
    expect(host.textContent).toContain('Authentication required');
    expect(host.querySelector('[data-testid=health-core]')).toBeNull();
  });
});
