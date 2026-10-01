import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { toPublicUrl } from '../../lib/appTarget';
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
  AdminVerification,
  AuditLogEntry,
  BillingAttempt,
  BillingEventSummary,
  Job,
  Review,
} from '../../lib/apiTypes';
import { Inbox, type LucideIcon } from 'lucide-react';
import { AdminSelect, InfoTip } from './ui';
import { formatNumber, formatDate, formatDateTime } from '../../lib/format';

// Shared state, helpers and small dialogs used by every admin tab. Kept in one
// file (rather than one file per helper) so the tabs stay easy to scan.
//
// Users is not here: it has its own server-side search and paging and fetches
// itself directly from UsersTab (see FORM-01), so it never joins this bulk load.

// Each panel loads independently: one failing endpoint must not blank the whole console.
export type Data = {
  stats: Partial<AdminStats>;
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
// page/perPage/total are the shared pagination envelope every list endpoint adds (E2).
export type Payload = Partial<{
  stats: AdminStats;
  jobs: Job[];
  reviews: Review[];
  requests: AdminVerification[];
  reports: AdminReport[];
  logs: AuditLogEntry[];
  subscriptions: AdminSubscription[];
  bookings: AdminBooking[];
  attempts: BillingAttempt[];
  events: BillingEventSummary[];
  page: number;
  perPage: number;
  total: number;
}>;
export const SOURCES: {
  [K in Source]: readonly [path: string, read: (d: Payload | null) => Data[K]];
} = {
  stats: ['/admin/stats', (d) => d?.stats || {}],
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

// D3: status/entityType/reason filters for the reports tab, applied on top of the shared
// page/perPage paging above (Admin::ReportsController#index).
export type ReportFilters = { status: string; entityType: string; reason: string };
export const DEFAULT_REPORT_FILTERS: ReportFilters = { status: 'open', entityType: '', reason: '' };
export const REPORT_ENTITY_TYPES = ['user', 'job', 'act', 'review'] as const;
export const REPORT_REASONS = [
  'Harassment',
  'Asks for payment',
  'Spam or scam',
  'Unsafe contact request',
  'Misleading listing',
  'Other',
] as const;
export const reportsQuery = (filters: ReportFilters, page: number, perPage = 100) => {
  const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (filters.status) qs.set('status', filters.status);
  if (filters.entityType) qs.set('entityType', filters.entityType);
  if (filters.reason) qs.set('reason', filters.reason);
  return `${SOURCES.reports[0]}?${qs.toString()}`;
};

// The Opportunity queue's status filter. Applied server-side (Admin::JobsController#index) before
// paging, so the pager's total counts exactly the rows being paged. "pending" is the working queue.
export const JOB_STATUS_OPTIONS = [
  { value: 'pending', label: 'Waiting for review' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All statuses' },
] as const;
export type JobStatusFilter = (typeof JOB_STATUS_OPTIONS)[number]['value'];
export const DEFAULT_JOB_STATUS: JobStatusFilter = 'pending';
export const jobsQuery = (status: JobStatusFilter, page: number, perPage = 100) => {
  const qs = new URLSearchParams({ page: String(page), perPage: String(perPage), status });
  return `${SOURCES.jobs[0]}?${qs.toString()}`;
};

// The console's tabs, in display order. The active one lives in the URL (?tab=) so a reload
// and a shared link both keep it. Unknown values fall back to the queue.
export const ADMIN_TABS = [
  'queue',
  'verification',
  'reports',
  'users',
  'reviews',
  'signin',
  'commerce',
  'codes',
  'operations',
  'audit',
  'demo',
  'ai',
  'urgent',
  'funnel',
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export const DEFAULT_ADMIN_TAB: AdminTab = 'queue';
export const readAdminTab = (value: string | null): AdminTab =>
  (ADMIN_TABS as readonly string[]).includes(value ?? '') ? (value as AdminTab) : DEFAULT_ADMIN_TAB;

// Pagination envelope every paged admin list answers with (page/perPage/total).
export type PageMeta = { page: number; perPage: number; total: number };
export const readMeta = (d: Payload | null): PageMeta | null =>
  d && typeof d.page === 'number' && typeof d.perPage === 'number' && typeof d.total === 'number'
    ? { page: d.page, perPage: d.perPage, total: d.total }
    : null;
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
  return withTime ? formatDateTime(value, { fallback: '—' }) : formatDate(value, { fallback: '—' });
};
// On the admin build there is no public route to resolve a relative path against — those pages
// simply don't exist in this bundle — so the link must be absolute to the public site instead.
export const entityLink = (type: string, id: string) => {
  const path =
    type === 'Job' || type === 'job'
      ? `/opportunities/${id}`
      : type === 'User' || type === 'user'
        ? `/professionals/${id}`
        : type === 'Act' || type === 'act'
          ? `/acts/${id}`
          : null;
  return path && toPublicUrl(path);
};

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

// Prev/Next paging + "Showing X-Y of Z" for a list backed by a page/perPage/total
// response (E2). Renders nothing when everything already fits on one page.
export function Pager({
  meta,
  onPage,
  loading,
}: {
  meta?: PageMeta;
  onPage: (page: number) => void;
  loading: boolean;
}) {
  if (!meta || meta.total <= meta.perPage) return null;
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.perPage));
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
  const to = Math.min(meta.page * meta.perPage, meta.total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
      <p className="text-sm text-slate-400" aria-live="polite">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(meta.total)}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1 || loading} onClick={() => onPage(meta.page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-slate-400">
          Page {meta.page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={meta.page >= totalPages || loading}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
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
export function Empty({ text, hint, icon: Icon = Inbox }: { text: string; hint?: string; icon?: LucideIcon }) {
  return (
    <Card className="bg-white/[.03] border-white/10">
      <CardContent className="p-10 text-center flex flex-col items-center gap-2">
        <Icon aria-hidden="true" size={24} className="text-slate-500" />
        <p className="text-slate-300">{text}</p>
        {hint && <p className="text-sm text-slate-500">{hint}</p>}
      </CardContent>
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
              <span className="flex items-center gap-1.5">
                <Label htmlFor="admin-grant-plan">Plan</Label>
                <InfoTip label="Plan" text="The tier this account is switched to immediately, at no charge." />
              </span>
              <AdminSelect
                id="admin-grant-plan"
                value={plan}
                onChange={setPlan}
                options={GRANTABLE_PLANS.map(([code, name]) => ({ value: code, label: name }))}
              />
            </div>
            <div className="grid gap-2">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="admin-grant-days">Days</Label>
                <InfoTip
                  label="Days"
                  text="How many days the granted plan stays active before it expires on its own."
                />
              </span>
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
