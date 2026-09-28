import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type {
  AdminBooking,
  AdminReport,
  AdminStats,
  AdminSubscription,
  AdminUser,
  AdminVerification,
  AuditLogEntry,
  BillingAttempt,
  BillingEventSummary,
  Job,
  Review,
} from '../../lib/apiTypes';
import type { LucideIcon } from 'lucide-react';

// Shared state, helpers and small dialogs used by every admin tab. Kept in one
// file (rather than one file per helper) so the tabs stay easy to scan.

// Each panel loads independently: one failing endpoint must not blank the whole console.
export type Data = {
  stats: Partial<AdminStats>;
  users: AdminUser[];
  jobs: Job[];
  reviews: Review[];
  verifications: AdminVerification[];
  reports: AdminReport[];
  logs: AuditLogEntry[];
  subscriptions: AdminSubscription[];
  bookings: AdminBooking[];
  attempts: BillingAttempt[];
  billingEvents: BillingEventSummary[];
};
export type Source = keyof Data;
// What the admin list endpoints answer with; each source reads its own key.
export type Payload = Partial<{
  stats: AdminStats;
  users: AdminUser[];
  jobs: Job[];
  reviews: Review[];
  requests: AdminVerification[];
  reports: AdminReport[];
  logs: AuditLogEntry[];
  subscriptions: AdminSubscription[];
  bookings: AdminBooking[];
  attempts: BillingAttempt[];
  events: BillingEventSummary[];
}>;
export const SOURCES: {
  [K in Source]: readonly [path: string, read: (d: Payload | null) => Data[K]];
} = {
  stats: ['/admin/stats', (d) => d?.stats || {}],
  users: ['/admin/users', (d) => d?.users || []],
  jobs: ['/admin/jobs', (d) => d?.jobs || []],
  reviews: ['/admin/reviews', (d) => d?.reviews || []],
  verifications: ['/admin/verifications', (d) => d?.requests || []],
  reports: ['/admin/reports', (d) => d?.reports || []],
  logs: ['/admin/audit', (d) => d?.logs || []],
  subscriptions: ['/admin/subscriptions', (d) => d?.subscriptions || []],
  bookings: ['/admin/bookings', (d) => d?.bookings || []],
  attempts: ['/admin/billing-attempts', (d) => d?.attempts || []],
  billingEvents: ['/admin/billing-events', (d) => d?.events || []],
};
export const readSource = <K extends Source>(next: Partial<Data>, k: K, d: Payload | null) => {
  next[k] = SOURCES[k][1](d);
};
export const EMPTY: Data = {
  stats: {},
  users: [],
  jobs: [],
  reviews: [],
  verifications: [],
  reports: [],
  logs: [],
  subscriptions: [],
  bookings: [],
  attempts: [],
  billingEvents: [],
};
export const GRANTABLE_PLANS = [
  ['pro', 'Pro'],
  ['studio', 'Studio'],
  ['enterprise', 'Enterprise'],
] as const;
export const RECONCILABLE = new Set(['pending', 'ambiguous', 'failed']);
export const USER_PAGE = 150;

export type Confirm = {
  title: string;
  description: string;
  confirmLabel: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  destructive?: boolean;
  run: (reason: string) => Promise<void>;
};
export type Grant = { id: string; name: string; email: string };

// Bag of moderation actions shared by every tab that mutates something, so
// each tab only needs one prop instead of five.
export type AdminActions = {
  busy: string | null;
  act: (key: string, request: () => Promise<unknown>, message: string) => Promise<void>;
  patch: (key: string, path: string, body: Record<string, unknown>, message: string) => Promise<void>;
  setConfirm: (c: Confirm | null) => void;
  setGrant: (g: Grant | null) => void;
};

export const date = (value: string | null | undefined, withTime = false) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : withTime ? d.toLocaleString() : d.toLocaleDateString();
};
export const entityLink = (type: string, id: string) =>
  type === 'Job' || type === 'job'
    ? `/opportunities/${id}`
    : type === 'User' || type === 'user'
      ? `/professionals/${id}`
      : type === 'Act' || type === 'act'
        ? `/acts/${id}`
        : null;

export function Stat({
  label,
  value,
  icon: I,
  hasError,
}: {
  label: string;
  value?: number;
  icon: LucideIcon;
  hasError: boolean;
}) {
  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardContent className="p-4 md:p-5 flex items-center gap-4">
        <div className="p-3 rounded-xl bg-violet-500/10">
          <I aria-hidden="true" className="text-violet-300" />
        </div>
        <div>
          <div className="text-2xl font-bold text-white">{hasError ? '—' : (value ?? 0)}</div>
          <div className="text-sm text-slate-400">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Panel({
  error,
  onRetry,
  loading,
  children,
}: {
  error?: string;
  onRetry: () => void;
  loading: boolean;
  children: ReactNode;
}) {
  return error ? <PanelError message={error} onRetry={onRetry} loading={loading} /> : <>{children}</>;
}
export function PanelError({ message, onRetry, loading }: { message: string; onRetry: () => void; loading: boolean }) {
  return (
    <Card className="bg-rose-500/[.06] border-rose-400/20">
      <CardContent className="p-6 text-center" role="alert">
        <p className="text-rose-200">This panel could not load: {message}</p>
        <Button size="sm" variant="outline" className="mt-4" disabled={loading} onClick={onRetry}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <Card className="bg-white/[.03] border-white/10">
      <CardContent className="p-10 text-center text-slate-400">{text}</CardContent>
    </Card>
  );
}

export function ConfirmDialog({ value, onClose }: { value: Confirm | null; onClose: () => void }) {
  const [reason, setReason] = useState(''),
    [pending, setPending] = useState(false);
  useEffect(() => {
    setReason('');
    setPending(false);
  }, [value]);
  const trimmed = reason.trim(),
    invalid = !!value?.reasonRequired && trimmed.length < 5;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || invalid || pending) return;
    setPending(true);
    try {
      await value.run(trimmed);
      onClose();
    } catch {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="bg-slate-950 border-white/15 text-white">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{value?.title}</DialogTitle>
            <DialogDescription className="text-slate-400">{value?.description}</DialogDescription>
          </DialogHeader>
          {value?.reasonLabel && (
            <div className="grid gap-2">
              <Label htmlFor="admin-confirm-reason">
                {value.reasonLabel}
                {value.reasonRequired && <span aria-hidden="true"> *</span>}
              </Label>
              <Textarea
                id="admin-confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={value.reasonRequired}
                minLength={value.reasonRequired ? 5 : undefined}
                maxLength={2000}
                aria-describedby="admin-confirm-reason-hint"
                className="bg-white/5 border-white/15 min-h-28"
                autoFocus
              />
              <p id="admin-confirm-reason-hint" className="text-xs text-slate-400">
                {value.reasonRequired ? 'At least 5 characters. ' : ''}Shown to the account owner.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={value?.destructive ? 'destructive' : 'default'}
              disabled={invalid || pending}
              aria-busy={pending}
            >
              {pending ? 'Working…' : value?.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GrantPlanDialog({
  value,
  busy,
  onClose,
  onGrant,
}: {
  value: Grant | null;
  busy: boolean;
  onClose: () => void;
  onGrant: (g: Grant, planCode: string, days: number) => Promise<void>;
}) {
  const [plan, setPlan] = useState('pro'),
    [days, setDays] = useState('30'),
    [pending, setPending] = useState(false);
  useEffect(() => {
    setPlan('pro');
    setDays('30');
    setPending(false);
  }, [value]);
  const n = Number(days),
    valid = /^\d+$/.test(days) && n >= 1 && n <= 366;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || !valid || pending || busy) return;
    setPending(true);
    try {
      await onGrant(value, plan, n);
      onClose();
    } catch {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="bg-slate-950 border-white/15 text-white">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Grant a plan to {value?.name}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {value?.email}. Any current subscription is cancelled and replaced by an internal, unpaid plan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="admin-grant-plan">Plan</Label>
              <select
                id="admin-grant-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="h-10 rounded-md bg-slate-900 border border-white/15 px-3"
              >
                {GRANTABLE_PLANS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-grant-days">Days</Label>
              <Input
                id="admin-grant-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={366}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-invalid={!valid}
                aria-describedby="admin-grant-days-hint"
                className="bg-white/5 border-white/15"
              />
              <p id="admin-grant-days-hint" className={`text-xs ${valid ? 'text-slate-400' : 'text-rose-300'}`}>
                Whole days, 1–366.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending || busy} aria-busy={pending}>
              {pending ? 'Granting…' : 'Grant plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
