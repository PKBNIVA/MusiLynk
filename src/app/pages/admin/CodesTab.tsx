import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Plus, Search, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { apiDownload } from '../../lib/download';
import { errorMessage } from '../../lib/errors';
import type { AdminPromoCode, AdminPromoProgramme, AdminPromoRedemption, PromoKind } from '../../lib/apiTypes';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Empty, Pager, Panel, date, type AdminActions, type PageMeta } from './shared';
import { AdminPageHeader, AdminSelect, HowToCallout } from './ui';
import { formatInputEcho } from '../../lib/format';

const PER_PAGE = 25;
const KIND_LABEL: Record<PromoKind, string> = {
  discount_percent: 'Discount',
  extended_trial: 'Extended trial',
  early_access: 'Early Access',
  referral: 'Referral',
};
const CREATE_KINDS = ['discount_percent', 'extended_trial', 'early_access'] as const;
const PLAN_OPTIONS = [
  { value: 'pro', label: 'Pro' },
  { value: 'studio', label: 'Studio' },
];
const INTERVAL_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

type ListResponse = { codes: AdminPromoCode[]; programme: AdminPromoProgramme } & PageMeta;

export function effectText(c: AdminPromoCode, programme?: AdminPromoProgramme | null) {
  switch (c.kind) {
    case 'discount_percent':
      return `${c.percentOff}% off${c.durationPeriods ? ` for ${c.durationPeriods} periods` : ' forever'}`;
    case 'extended_trial':
      return `${c.trialDays}-day free trial`;
    case 'early_access':
      return `Early Access Pro${programme ? ` · ${programme.earlyAccess.days} days` : ''}`;
    default:
      return programme
        ? `${programme.referral.refereePercentOff}% off for ${programme.referral.refereeDurationPeriods} periods`
        : 'Referral discount';
  }
}

/** A sample code built from the configured format, e.g. VERSE-{6} -> VERSE-K7M2QP. */
export function previewCode(format: string, alphabet: string) {
  let offset = 3;
  return format.replace(/\{(?:NAME)?(\d+)\}/g, (_m, count: string) =>
    Array.from({ length: Number(count) }, () => alphabet[(offset += 7) % alphabet.length]).join(''),
  );
}

const scope = (values: string[], all: string) =>
  values.length ? values.map((v) => v[0].toUpperCase() + v.slice(1)).join(', ') : all;

export default function CodesTab({ actions }: { actions: AdminActions }) {
  const { setConfirm } = actions;
  const [kind, setKind] = useState('');
  const [active, setActive] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<AdminPromoCode | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    (p: number) => {
      const id = ++requestId.current;
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(p), perPage: String(PER_PAGE) });
      if (kind) params.set('kind', kind);
      if (active) params.set('active', active);
      if (query.trim()) params.set('q', query.trim());
      apiGet<ListResponse>(`/admin/promo-codes?${params.toString()}`)
        .then((res) => {
          if (id === requestId.current) setData(res);
        })
        .catch((e: unknown) => {
          if (id === requestId.current) setError(errorMessage(e, 'Unable to load codes.'));
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    },
    [kind, active, query],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load(1);
    }, 300);
    return () => clearTimeout(t);
  }, [load]);

  const codes = data?.codes ?? [];
  const programme = data?.programme ?? null;

  async function exportCsv(batchId?: string) {
    setExporting(true);
    try {
      const blob = await apiDownload(
        `/admin/promo-codes/export.csv${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ''}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `promo-codes${batchId ? `-${batchId}` : ''}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'The export could not be prepared.'));
    } finally {
      setExporting(false);
    }
  }

  function deactivate(c: AdminPromoCode) {
    setConfirm({
      title: `Deactivate ${c.code}?`,
      description: 'The code stops working straight away. People who already redeemed it keep their discount or trial.',
      confirmLabel: 'Deactivate code',
      destructive: true,
      run: async () => {
        await actions.act(
          `code:${c.id}`,
          () => apiPatch(`/admin/promo-codes/${c.id}`, { active: false }),
          'Code deactivated',
        );
        load(page);
      },
    });
  }

  return (
    <Panel error={error} onRetry={() => load(page)} loading={loading}>
      <AdminPageHeader
        icon={Ticket}
        title="Codes"
        description="Discount, extended-trial and Early Access codes, and how referral codes are doing."
      />
      <HowToCallout storageKey="codes">
        Create a <b>vanity code</b> for a campaign or <b>generate a batch</b> for a partner, then paste any discount
        code&apos;s Razorpay offer id here. Against live Razorpay a discount only applies through an Offer, so codes
        without one are flagged and refused at checkout.
      </HowToCallout>

      {programme && (
        <Card className="bg-white/[.04] border-white/10 mb-4" data-testid="referral-programme">
          <CardContent className="p-4 text-sm text-slate-300">
            <div className="flex flex-wrap items-center gap-2">
              <b>Referral programme</b>
              <Badge
                className={
                  programme.referral.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-slate-300'
                }
              >
                {programme.referral.enabled ? 'On' : 'Off'}
              </Badge>
              {!programme.referral.offerConfigured && programme.offerRequired && (
                <Badge className="bg-amber-500/15 text-amber-200">
                  <AlertTriangle aria-hidden="true" size={12} className="mr-1" />
                  Razorpay offer not set
                </Badge>
              )}
            </div>
            <p className="mt-1.5">
              Referred hirers get {programme.referral.refereePercentOff}% off for{' '}
              {programme.referral.refereeDurationPeriods} billing periods. The referrer earns{' '}
              {programme.referral.referrerRewardDays} free days per referral, up to{' '}
              {programme.referral.referrerRewardCap} rewards.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {programme.editNote} The offer id is the RAZORPAY_REFERRAL_OFFER_ID setting.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Label htmlFor="admin-code-search" className="sr-only">
            Search codes
          </Label>
          <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="admin-code-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or note"
            className="pl-9 bg-white/5 border-white/15"
          />
        </div>
        <Label htmlFor="admin-code-kind" className="sr-only">
          Filter by kind
        </Label>
        <AdminSelect
          id="admin-code-kind"
          value={kind}
          onChange={setKind}
          className="w-44"
          options={[
            { value: '', label: 'All kinds' },
            ...(['discount_percent', 'extended_trial', 'early_access', 'referral'] as const).map((k) => ({
              value: k,
              label: KIND_LABEL[k],
            })),
          ]}
        />
        <Label htmlFor="admin-code-active" className="sr-only">
          Filter by state
        </Label>
        <AdminSelect
          id="admin-code-active"
          value={active}
          onChange={setActive}
          className="w-36"
          options={[
            { value: '', label: 'Any state' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]}
        />
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" disabled={exporting} onClick={() => void exportCsv()}>
            <Download aria-hidden="true" size={15} className="mr-1.5" />
            {exporting ? 'Preparing…' : 'Export CSV'}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" size={15} className="mr-1.5" />
            New code
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {!loading && codes.length === 0 ? (
          <Empty
            icon={Ticket}
            text={query || kind || active ? 'No codes match these filters.' : 'No codes yet.'}
            hint={
              query || kind || active
                ? undefined
                : 'Create one to offer a discount, a longer trial or Early Access Pro.'
            }
          />
        ) : (
          <Card className="bg-white/[.04] border-white/10 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  {['Code', 'Kind', 'Effect', 'Plan · interval', 'Used', 'Expires', 'State', ''].map((h) => (
                    <TableHead key={h || 'actions'} className="text-slate-400">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.id} className="border-white/10 hover:bg-white/[.03]" data-testid="code-row">
                    <TableCell className="font-mono font-medium">
                      {c.code}
                      {c.notes && (
                        <div className="font-sans text-xs font-normal text-slate-500 max-w-48 truncate">{c.notes}</div>
                      )}
                    </TableCell>
                    <TableCell>{KIND_LABEL[c.kind]}</TableCell>
                    <TableCell>
                      {effectText(c, programme)}
                      {c.needsOffer && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-amber-200" data-testid="needs-offer">
                          <AlertTriangle aria-hidden="true" size={12} />
                          Needs a Razorpay offer id
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {scope(c.planCodes, 'All plans')} · {scope(c.intervals, 'both')}
                    </TableCell>
                    <TableCell>
                      {c.redemptionsCount}
                      {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                    </TableCell>
                    <TableCell>{c.expiresAt ? date(c.expiresAt) : 'Never'}</TableCell>
                    <TableCell>
                      <Badge className={c.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-slate-300'}>
                        {c.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setViewing(c)}>
                          Redemptions
                        </Button>
                        {c.active && (
                          <Button size="sm" variant="outline" className="text-rose-300" onClick={() => deactivate(c)}>
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        <Pager
          meta={data ? { page: data.page, perPage: data.perPage, total: data.total } : undefined}
          loading={loading}
          onPage={(p) => {
            setPage(p);
            load(p);
          }}
        />
      </div>

      <CreateCodeDialog
        open={creating}
        programme={programme}
        onClose={() => setCreating(false)}
        onCreated={(batchId) => {
          setCreating(false);
          load(1);
          setPage(1);
          if (batchId)
            toast.success('Batch created. Use Export CSV for the codes.', {
              action: { label: 'Export batch', onClick: () => void exportCsv(batchId) },
            });
        }}
      />
      <RedemptionsSheet code={viewing} onClose={() => setViewing(null)} />
    </Panel>
  );
}

function CreateCodeDialog({
  open,
  programme,
  onClose,
  onCreated,
}: {
  open: boolean;
  programme: AdminPromoProgramme | null;
  onClose: () => void;
  onCreated: (batchId?: string) => void;
}) {
  const blank = {
    kind: 'discount_percent' as (typeof CREATE_KINDS)[number],
    mode: 'vanity',
    code: '',
    generate: '10',
    percentOff: '20',
    durationPeriods: '',
    trialDays: '90',
    plans: [] as string[],
    intervals: [] as string[],
    maxRedemptions: '',
    perUserLimit: '1',
    expiresAt: '',
    razorpayOfferId: '',
    notes: '',
  };
  const [form, setForm] = useState(blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm(blank);
      setError('');
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time the dialog opens
  }, [open]);
  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key: 'plans' | 'intervals', value: string, on: boolean) =>
    setForm((f) => ({ ...f, [key]: on ? [...f[key], value] : f[key].filter((v) => v !== value) }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    const body: Record<string, unknown> = {
      kind: form.kind,
      planCodes: form.plans,
      intervals: form.intervals,
      maxRedemptions: num(form.maxRedemptions),
      perUserLimit: num(form.perUserLimit),
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : undefined,
      notes: form.notes.trim() || undefined,
    };
    if (form.kind === 'discount_percent') {
      body.percentOff = num(form.percentOff);
      body.durationPeriods = num(form.durationPeriods);
      body.razorpayOfferId = form.razorpayOfferId.trim() || undefined;
    }
    if (form.kind === 'extended_trial') body.trialDays = num(form.trialDays);
    if (form.mode === 'batch') body.generate = num(form.generate);
    else body.code = form.code.trim();
    try {
      const res = await apiPost<{ batchId?: string }>('/admin/promo-codes', body);
      toast.success(form.mode === 'batch' ? `${form.generate} codes generated` : 'Code created');
      onCreated(res.batchId);
    } catch (err: unknown) {
      setError(errorMessage(err, 'The code could not be created.'));
      setPending(false);
    }
  }

  const preview = programme ? previewCode(programme.codeFormat, programme.codeAlphabet) : '';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="bg-slate-950 border-white/15 text-white max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New code</DialogTitle>
            <DialogDescription>Only the fields that apply to the kind you pick are shown.</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="code-kind">Kind</Label>
              <AdminSelect
                id="code-kind"
                value={form.kind}
                onChange={(v) => set('kind', v as (typeof CREATE_KINDS)[number])}
                options={CREATE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="code-mode">Code</Label>
              <AdminSelect
                id="code-mode"
                value={form.mode}
                onChange={(v) => set('mode', v)}
                options={[
                  { value: 'vanity', label: 'One vanity code' },
                  { value: 'batch', label: 'Generate a batch' },
                ]}
              />
            </div>
          </div>
          {form.mode === 'vanity' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="code-value">Code</Label>
              <Input
                id="code-value"
                value={form.code}
                required
                maxLength={40}
                autoComplete="off"
                className="uppercase bg-white/5 border-white/15"
                placeholder="MUMBAI50"
                onChange={(e) => set('code', e.target.value)}
              />
              <p className="text-xs text-slate-500">Letters, digits, dashes and underscores. Stored in upper case.</p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="code-generate">How many codes</Label>
              <Input
                id="code-generate"
                type="number"
                min={1}
                max={500}
                required
                value={form.generate}
                className="bg-white/5 border-white/15"
                onChange={(e) => set('generate', e.target.value)}
              />
              {programme && (
                <p className="text-xs text-slate-500" data-testid="format-preview">
                  Format {programme.codeFormat}, for example {preview}. Set in config/billing.yml.
                </p>
              )}
            </div>
          )}
          {form.kind === 'discount_percent' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="code-percent">Percent off</Label>
                <Input
                  id="code-percent"
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={form.percentOff}
                  className="bg-white/5 border-white/15"
                  onChange={(e) => set('percentOff', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="code-periods">Billing periods</Label>
                <Input
                  id="code-periods"
                  type="number"
                  min={1}
                  value={form.durationPeriods}
                  placeholder="Forever"
                  className="bg-white/5 border-white/15"
                  onChange={(e) => set('durationPeriods', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="code-offer">Razorpay offer id</Label>
                <Input
                  id="code-offer"
                  value={form.razorpayOfferId}
                  placeholder="offer_…"
                  autoComplete="off"
                  className="bg-white/5 border-white/15"
                  onChange={(e) => set('razorpayOfferId', e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Razorpay → Offers. Required for the discount to apply to live billing.
                </p>
              </div>
            </div>
          )}
          {form.kind === 'extended_trial' && (
            <div className="grid gap-1.5">
              <Label htmlFor="code-trial">Trial days</Label>
              <Input
                id="code-trial"
                type="number"
                min={1}
                max={365}
                required
                value={form.trialDays}
                className="bg-white/5 border-white/15"
                onChange={(e) => set('trialDays', e.target.value)}
              />
            </div>
          )}
          {form.kind === 'early_access' && programme && (
            <p className="text-sm text-slate-300 rounded-lg bg-white/5 p-3">
              Grants Early Access Pro for {programme.earlyAccess.days} days, no card. {programme.earlyAccess.granted} of{' '}
              {programme.earlyAccess.seats} seats are taken; the seat cap applies to codes too.
            </p>
          )}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Limit to (none ticked = all)</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {PLAN_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2">
                  <Checkbox
                    checked={form.plans.includes(o.value)}
                    onCheckedChange={(c) => toggle('plans', o.value, c === true)}
                  />
                  {o.label}
                </label>
              ))}
              {INTERVAL_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2">
                  <Checkbox
                    checked={form.intervals.includes(o.value)}
                    onCheckedChange={(c) => toggle('intervals', o.value, c === true)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="code-max">Max redemptions</Label>
              <Input
                id="code-max"
                type="number"
                min={1}
                value={form.maxRedemptions}
                placeholder="Unlimited"
                className="bg-white/5 border-white/15"
                onChange={(e) => set('maxRedemptions', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="code-per-user">Per person</Label>
              <Input
                id="code-per-user"
                type="number"
                min={1}
                value={form.perUserLimit}
                className="bg-white/5 border-white/15"
                onChange={(e) => set('perUserLimit', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="code-expires">Expires on</Label>
              <Input
                id="code-expires"
                type="date"
                value={form.expiresAt}
                className="bg-white/5 border-white/15"
                onChange={(e) => set('expiresAt', e.target.value)}
              />
              {form.expiresAt && <p className="text-xs text-slate-400">{formatInputEcho(form.expiresAt)}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="code-notes">Notes</Label>
            <Textarea
              id="code-notes"
              value={form.notes}
              maxLength={2000}
              rows={2}
              className="bg-white/5 border-white/15"
              placeholder="Who is this for?"
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : form.mode === 'batch' ? 'Generate codes' : 'Create code'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RedemptionsSheet({ code, onClose }: { code: AdminPromoCode | null; onClose: () => void }) {
  const [rows, setRows] = useState<AdminPromoRedemption[] | null>(null);
  const [error, setError] = useState('');
  const id = code?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    setRows(null);
    setError('');
    apiGet<{ redemptions: AdminPromoRedemption[] }>(`/admin/promo-codes/${id}/redemptions?perPage=100`)
      .then((d) => live && setRows(d.redemptions))
      .catch((e: unknown) => live && setError(errorMessage(e, 'Unable to load redemptions.')));
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <Sheet open={!!code} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-slate-950 border-white/15 text-white w-full sm:max-w-md overflow-y-auto p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Redemptions · {code?.code}</SheetTitle>
          <SheetDescription>Who used this code, newest first.</SheetDescription>
        </SheetHeader>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        {!error && rows === null && <p className="text-sm text-slate-400">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-slate-400">Nobody has used this code yet.</p>}
        <ul className="space-y-3">
          {rows?.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 p-3 text-sm" data-testid="redemption-row">
              <div className="font-medium">{r.name || r.email || r.userId}</div>
              {r.name && r.email && <div className="text-xs text-slate-400 break-all">{r.email}</div>}
              <div className="text-xs text-slate-400 mt-1">{date(r.redeemedAt, true)}</div>
              {r.referrerReward && (
                <div className="text-xs text-emerald-300 mt-1">
                  Referrer earned {r.referrerReward.days} days
                  {r.referrerReward.appliedAt ? '' : ' (credit recorded, not yet applied)'}
                </div>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
