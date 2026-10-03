import { useCallback, useEffect, useState } from 'react';
import { HeartPulse, RefreshCw } from 'lucide-react';
import { apiGet, ApiError } from '../../lib/api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Panel } from './shared';
import { AdminPageHeader } from './ui';

/** GET /api/admin/health: the readiness checks the deploy uses, plus release and environment. */
export interface AdminHealth {
  ok: boolean;
  service: string;
  release: string;
  time: string;
  environment: string;
  coreReady: boolean;
  optionalIntegrationsReady: boolean;
  checks: Record<string, HealthCheck>;
  emailSuppressions?: Record<string, unknown>;
}
export interface HealthCheck {
  ok: boolean;
  required: boolean;
  [detail: string]: unknown;
}

/** "razorpayWebhook" → "Razorpay webhook", "frontendUrl" → "Frontend URL". */
export const checkLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`)
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\burl\b/i, 'URL');

/** The check's extra fields (engine, problems, uploadMethod…) as one short line; never a secret, the API sends codes only. */
export function checkDetails(check: HealthCheck): string {
  return Object.entries(check)
    .filter(
      ([key, value]) => key !== 'ok' && key !== 'required' && value !== null && value !== undefined && value !== '',
    )
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');
}

/** Required checks first, then by name; a failing check before a passing one within each group. */
export function orderChecks(checks: Record<string, HealthCheck>): [string, HealthCheck][] {
  return Object.entries(checks).sort(([aKey, a], [bKey, b]) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return aKey.localeCompare(bKey);
  });
}

/**
 * Health: a read-only view of GET /api/admin/health (the same checks a deploy waits for) so an
 * admin can see whether the API, its database and the optional integrations are ready, and which
 * release is live, without opening Railway. Nothing can be changed from here.
 */
export default function HealthTab() {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(undefined);
    apiGet<AdminHealth>('/admin/health')
      .then((body) => setHealth(body))
      .catch((failure: unknown) => {
        // The endpoint answers 503 while a required check fails; say so instead of a generic error.
        if (failure instanceof ApiError && failure.status === 503)
          setError(
            'The API reports it is not ready (503): a required check is failing. See the Railway logs for the request id.',
          );
        else setError(failure instanceof Error ? failure.message : 'Could not load the health report.');
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <div data-testid="health-panel">
      <AdminPageHeader
        icon={HeartPulse}
        title="Health"
        description="What the deploy's readiness check sees right now: the API, its database and each integration."
      />
      <Panel error={error} onRetry={load} loading={loading}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {health && (
            <>
              <Badge
                data-testid="health-core"
                className={health.coreReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}
              >
                {health.coreReady ? 'Core ready' : 'Core not ready'}
              </Badge>
              <Badge
                data-testid="health-optional"
                className={
                  health.optionalIntegrationsReady
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : 'bg-amber-500/15 text-amber-200'
                }
              >
                {health.optionalIntegrationsReady ? 'Integrations ready' : 'Some integrations off'}
              </Badge>
              <span className="text-sm text-slate-300" data-testid="health-release">
                Release <code className="font-mono text-slate-100">{health.release}</code> · {health.environment} ·
                checked {new Date(health.time).toLocaleTimeString()}
              </span>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" size={14} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-white/10" aria-label="Readiness checks" aria-busy={loading}>
              {health
                ? orderChecks(health.checks).map(([key, check]) => (
                    <li
                      key={key}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                      data-testid={`health-check-${key}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 rounded-full ${check.ok ? 'bg-emerald-400' : check.required ? 'bg-rose-400' : 'bg-amber-400'}`}
                      />
                      <span className="min-w-40 font-semibold">{checkLabel(key)}</span>
                      <span className="text-sm text-slate-300">
                        {check.ok ? 'OK' : check.required ? 'Not ready' : 'Off'}
                        {!check.required && <span className="text-slate-500"> · optional</span>}
                      </span>
                      <span className="text-xs text-slate-400">{checkDetails(check)}</span>
                    </li>
                  ))
                : !error && <li className="px-4 py-3 text-sm text-slate-400">Loading the health report…</li>}
            </ul>
          </CardContent>
        </Card>
      </Panel>
    </div>
  );
}
