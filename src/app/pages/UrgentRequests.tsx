import { EmptyState } from '../components/kit/EmptyState';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../lib/authContext';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Field, FormDialog, textareaClass, useConfirm } from '../components/booking/BookingDialogs';
import { UrgentRequestFields } from '../components/urgent/UrgentRequestFields';
import { URGENT_PROMISE, useUrgentForm } from '../lib/urgentForm';
import { Clock3, Zap, Siren } from 'lucide-react';
import { errorMessage } from '../lib/errors';
import type { UrgentRequest, UrgentRequestResponse } from '../lib/apiTypes';
import { trackUrgentRequestSubmitted, trackUrgentResponseSubmitted } from '../lib/analytics';

const whole = (v: string) => /^\d+$/.test(v.trim());

export default function UrgentRequests() {
  const { user } = useAuth();
  const [items, setItems] = useState<UrgentRequest[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [city, setCity] = useState(''),
    [role, setRole] = useState(''),
    [responses, setResponses] = useState<Record<string, UrgentRequestResponse[]>>({}),
    [expanded, setExpanded] = useState<string | null>(null),
    [posting, setPosting] = useState(false),
    [reply, setReply] = useState<{ request: UrgentRequest; message: string; rate: string } | null>(null),
    [formError, setFormError] = useState(''),
    // The mutation in flight ("create" or a request id); others wait so nothing is submitted twice.
    [pending, setPending] = useState<string | null>(null);
  const urgent = useUrgentForm();
  const { ask, element: confirmDialog } = useConfirm();
  const load = useLatestCallback(async () => {
    const p = new URLSearchParams();
    if (city.trim()) p.set('city', city.trim());
    if (role.trim()) p.set('role', role.trim());
    try {
      const d = await apiGet<{ requests?: UrgentRequest[] }>(`/urgent-requests?${p}`);
      setItems(d.requests || []);
      setLoadError('');
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Unable to load urgent requests.'));
    } finally {
      setLoading(false);
    }
  });
  useEffect(() => {
    void load();
  }, [load]);
  async function create() {
    if (!posting || pending) return;
    const body = urgent.validate();
    if (!body) return;
    setPending('create');
    try {
      await apiPost('/urgent-requests', body);
      trackUrgentRequestSubmitted();
      toast.success('Urgent request published');
      setPosting(false);
      urgent.reset();
      await load();
    } catch (e: unknown) {
      if (urgent.form.setFromApi(e, 'Unable to publish this request.')) urgent.form.focusFirst();
    } finally {
      setPending(null);
    }
  }
  async function respond() {
    if (!reply || pending) return;
    if (reply.rate.trim() && !whole(reply.rate)) return setFormError('Rate must be a whole number.');
    if (reply.message.length > 1000) return setFormError('Keep your note under 1,000 characters.');
    setPending(reply.request.id);
    setFormError('');
    try {
      await apiPost(`/urgent-requests/${reply.request.id}/respond`, {
        message: reply.message.trim(),
        rate: reply.rate.trim() ? Number(reply.rate) : null,
      });
      trackUrgentResponseSubmitted();
      toast.success('Availability sent');
      setReply(null);
      await load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, 'Unable to send your availability.'));
    } finally {
      setPending(null);
    }
  }
  async function viewResponses(id: string) {
    if (expanded === id) return setExpanded(null);
    try {
      const data = await apiGet<{ responses?: UrgentRequestResponse[] }>(`/urgent-requests/${id}/responses`);
      setResponses((current) => ({ ...current, [id]: data.responses || [] }));
      setExpanded(id);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  const applyStatus = async (r: UrgentRequest, status: 'filled' | 'closed', filledByUserId?: string) => {
    await apiPatch(`/urgent-requests/${r.id}`, { status, filledByUserId });
    toast.success(status === 'filled' ? 'Request marked filled' : 'Request closed');
    setExpanded(null);
    await load();
  };
  const closeRequest = (r: UrgentRequest, status: 'filled' | 'closed', filledByUserId?: string) =>
    ask({
      title: status === 'filled' ? 'Mark this request filled?' : 'Close this request?',
      description: 'It stops appearing to professionals and cannot be reopened.',
      confirmLabel: status === 'filled' ? 'Mark filled' : 'Close request',
      destructive: status === 'closed',
      action: () => applyStatus(r, status, filledByUserId),
    });
  const [pickResponder, setPickResponder] = useState<UrgentRequest | null>(null);
  const markFilled = async (r: UrgentRequest) => {
    // "asks which responder, optional": load responses first so the hirer can pick one.
    if (!responses[r.id]) await viewResponses(r.id);
    setPickResponder(r);
  };
  const statusLabel = (status: string) =>
    ({ open: 'Open', filled: 'Filled', expired: 'Expired', closed: 'Closed', cancelled: 'Closed' })[status] || status;
  const filter = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    void load();
  };
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-6xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader
          title="Need someone by tomorrow"
          actions={
            <Button
              onClick={() => {
                urgent.reset();
                urgent.form.clear();
                setPosting(true);
              }}
              disabled={pending !== null}
            >
              <Zap size={16} className="mr-2" />
              Post urgent need
            </Button>
          }
        />
        <form role="search" onSubmit={filter} className="grid md:grid-cols-[1fr_1fr_auto] gap-3 mt-7">
          <Input
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Drummer, playback engineer…"
            className="bg-white/5 border-white/15"
          />
          <Input
            aria-label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            className="bg-white/5 border-white/15"
          />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading urgent requests…
          </p>
        ) : loadError ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Siren}
            className="mt-7"
            title={city || role ? 'No open requests match these filters.' : 'No open urgent requests right now.'}
          >
            {city || role ? 'Try a nearby city or a broader role.' : 'Post one when you need cover fast.'}
          </EmptyState>
        ) : (
          <div className="grid gap-4 mt-7">
            {items.map((r) => (
              <Card key={r.id} className="bg-white/[.055] border-white/10">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          data-testid="urgent-status-chip"
                          className={
                            r.status === 'open'
                              ? 'bg-orange-500/15 text-orange-200'
                              : r.status === 'filled'
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : r.status === 'expired'
                                  ? 'bg-rose-500/15 text-rose-200'
                                  : 'bg-white/10 text-slate-300'
                          }
                        >
                          {r.status === 'open' ? 'Urgent' : statusLabel(r.status)}
                        </Badge>
                        {r.requesterVerified && <Badge variant="secondary">Verified requester</Badge>}
                      </div>
                      <h2 className="text-xl font-semibold mt-3 break-words">{r.title}</h2>
                      <p className="text-violet-300">
                        {r.role_name}
                        {r.instrument ? ` · ${r.instrument}` : ''}
                      </p>
                      <p className="text-sm text-slate-400 mt-2">
                        {r.city} · <Clock3 size={14} className="inline mr-1" />
                        {new Date(r.start_at).toLocaleString()}
                      </p>
                      {Boolean(r.budget_min || r.budget_max) && (
                        <p className="text-sm text-emerald-300 mt-1">
                          Budget {r.currency}{' '}
                          {[r.budget_min, r.budget_max]
                            .filter(Boolean)
                            .map((x) => Number(x).toLocaleString('en-IN'))
                            .join(' – ')}
                        </p>
                      )}
                      {r.requirements && <p className="text-sm text-slate-300 mt-2 break-words">{r.requirements}</p>}
                      {Boolean(r.myMatchReasons?.length) && (
                        <p className="text-xs text-slate-500 mt-2">Why you: {r.myMatchReasons!.join(' · ')}</p>
                      )}
                      {r.status === 'filled' &&
                        (r.filled_by_id === user?.id ? (
                          <p className="text-sm text-emerald-300 mt-2">You were chosen</p>
                        ) : r.myResponse ? (
                          <p className="text-sm text-slate-400 mt-2">Filled — thanks for responding</p>
                        ) : null)}
                    </div>
                    {r.requester_id === user?.id ? (
                      <div className="flex flex-wrap sm:justify-end gap-2 items-start">
                        <Button
                          variant="secondary"
                          onClick={() => viewResponses(r.id)}
                          aria-expanded={expanded === r.id}
                        >
                          Responses ({r.responseCount || 0})
                        </Button>
                        {r.status === 'open' && (
                          <>
                            <Button variant="outline" onClick={() => markFilled(r)}>
                              Mark filled
                            </Button>
                            <Button variant="ghost" onClick={() => closeRequest(r, 'closed')}>
                              Close
                            </Button>
                          </>
                        )}
                      </div>
                    ) : user?.role === 'jobseeker' && r.status === 'open' ? (
                      <Button
                        className="self-start"
                        variant={r.myResponse ? 'outline' : 'default'}
                        onClick={() => {
                          setFormError('');
                          setReply({ request: r, message: '', rate: '' });
                        }}
                        disabled={pending !== null}
                      >
                        {r.myResponse ? 'Update response' : 'I’m available'}
                      </Button>
                    ) : (
                      r.status === 'open' && (
                        <p className="text-xs text-slate-500 sm:max-w-40">Professionals respond to this request.</p>
                      )
                    )}
                  </div>
                  {expanded === r.id && (
                    <div className="mt-5 border-t border-white/10 pt-4">
                      <h3 className="font-semibold">Available professionals</h3>
                      <div className="mt-3 space-y-2">
                        {(responses[r.id] || []).map((response) => (
                          <div key={response.user_id} className="rounded-xl border border-white/10 bg-black/15 p-3">
                            <div className="font-medium">{response.name}</div>
                            <div className="text-sm text-violet-300">{response.headline || 'Music professional'}</div>
                            {response.message && (
                              <p className="mt-2 text-sm text-slate-300 break-words">{response.message}</p>
                            )}
                            {response.rate != null && (
                              <p className="mt-1 text-sm text-emerald-300">
                                Rate: {r.currency} {Number(response.rate).toLocaleString('en-IN')}
                              </p>
                            )}
                          </div>
                        ))}
                        {!(responses[r.id] || []).length && <p className="text-sm text-slate-500">No responses yet.</p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <FormDialog
          open={posting}
          onOpenChange={(open) => !open && setPosting(false)}
          title="Post an urgent need"
          description="Visible to professionals until you mark it filled or cancel it."
          submitLabel="Publish request"
          busyLabel="Publishing…"
          busy={pending === 'create'}
          error={urgent.form.formError}
          wide
          onSubmit={create}
        >
          <UrgentRequestFields values={urgent.values} errors={urgent.form.errors} onChange={urgent.set} />
          <p className="flex items-center gap-1.5 text-sm text-slate-300">
            <Clock3 aria-hidden="true" size={14} />
            Expect a first response {URGENT_PROMISE}.
          </p>
        </FormDialog>
        <FormDialog
          open={Boolean(reply)}
          onOpenChange={(open) => !open && setReply(null)}
          title={reply?.request?.myResponse ? 'Update your availability' : "Tell them you're available"}
          description={reply?.request?.title}
          submitLabel="Send availability"
          busyLabel="Sending…"
          busy={Boolean(reply && pending === reply.request.id)}
          error={formError}
          onSubmit={respond}
        >
          {reply && (
            <>
              <Field label="Short availability note" htmlFor="urgent-reply-message">
                <textarea
                  id="urgent-reply-message"
                  maxLength={1000}
                  className={textareaClass}
                  value={reply.message}
                  onChange={(e) => setReply({ ...reply, message: e.target.value })}
                />
              </Field>
              <Field label={`Your rate in ${reply.request.currency || 'INR'} (optional)`} htmlFor="urgent-reply-rate">
                <Input
                  id="urgent-reply-rate"
                  type="number"
                  min="0"
                  value={reply.rate}
                  onChange={(e) => setReply({ ...reply, rate: e.target.value })}
                />
              </Field>
            </>
          )}
        </FormDialog>
        <FormDialog
          open={Boolean(pickResponder)}
          onOpenChange={(open) => !open && setPickResponder(null)}
          title="Mark this request filled"
          description="Optionally choose who you booked — they'll see they were chosen; other responders see it's filled."
          submitLabel="Mark filled"
          busyLabel="Marking filled…"
          busy={Boolean(pickResponder && pending === pickResponder.id)}
          error={formError}
          onSubmit={async () => {
            if (!pickResponder) return;
            const chosen = (document.querySelector('input[name="filled-by"]:checked') as HTMLInputElement | null)
              ?.value;
            await applyStatus(pickResponder, 'filled', chosen || undefined);
            setPickResponder(null);
          }}
        >
          {pickResponder && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="radio" name="filled-by" value="" defaultChecked /> No particular responder
              </label>
              {(responses[pickResponder.id] || []).map((response) => (
                <label key={response.user_id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="radio" name="filled-by" value={response.user_id} />
                  {response.name}
                </label>
              ))}
            </div>
          )}
        </FormDialog>
        {confirmDialog}
      </main>
    </div>
  );
}
