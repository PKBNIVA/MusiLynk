import { EmptyState } from '../components/kit/EmptyState';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { UserAvatar } from '../components/kit/UserAvatar';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../lib/authContext';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Field, FormDialog, textareaClass, useConfirm } from '../components/booking/BookingDialogs';
import { UrgentRequestFields } from '../components/urgent/UrgentRequestFields';
import { URGENT_PROMISE, useUrgentForm } from '../lib/urgentForm';
import { Clock3, Zap, Siren } from 'lucide-react';
import { errorMessage } from '../lib/errors';
import { formatMoney, formatPay, formatWhen } from '../lib/format';
import type { ConversationCreated, UrgentRequest, UrgentRequestResponse } from '../lib/apiTypes';
import { trackUrgentRequestSubmitted, trackUrgentResponseSubmitted } from '../lib/analytics';

const whole = (v: string) => /^\d+$/.test(v.trim());

type Scope = 'mine' | 'matches' | 'browse';
type UrgentPage = { requests?: UrgentRequest[]; page?: number; total?: number; hasMore?: boolean };

export default function UrgentRequests() {
  const { user } = useAuth();
  const nav = useNavigate();
  const base = `/${useLocation().pathname.split('/')[1] || 'employer'}`;
  // Musicians see what fits them first; hirers see their own requests, with the open ones a tab away (J-11).
  const tabs: { id: Scope; label: string }[] =
    user?.role === 'jobseeker'
      ? [
          { id: 'matches', label: 'Matches for you' },
          { id: 'browse', label: 'All open requests' },
          { id: 'mine', label: 'My requests' },
        ]
      : [
          { id: 'mine', label: 'My requests' },
          { id: 'browse', label: 'Browse open requests' },
        ];
  const [scope, setScope] = useState<Scope>(tabs[0].id);
  const [items, setItems] = useState<UrgentRequest[]>([]),
    [paging, setPaging] = useState({ page: 1, total: 0, hasMore: false }),
    [loadingMore, setLoadingMore] = useState(false),
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
  const openThread = (conversationId?: string | null) =>
    nav(`${base}/messages${conversationId ? `?c=${conversationId}` : ''}`);
  const fetchPage = (page: number, which: Scope = scope) => {
    const p = new URLSearchParams({ scope: which, page: String(page) });
    if (city.trim()) p.set('city', city.trim());
    if (role.trim()) p.set('role', role.trim());
    return apiGet<UrgentPage>(`/urgent-requests?${p}`);
  };
  const load = useLatestCallback(async (which: Scope = scope) => {
    try {
      const d = await fetchPage(1, which);
      setItems(d.requests || []);
      setPaging({ page: 1, total: d.total ?? (d.requests || []).length, hasMore: Boolean(d.hasMore) });
      setLoadError('');
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Unable to load urgent requests.'));
    } finally {
      setLoading(false);
    }
  });
  async function loadMore() {
    if (loadingMore || !paging.hasMore) return;
    setLoadingMore(true);
    try {
      const d = await fetchPage(paging.page + 1);
      setItems((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...(d.requests || []).filter((r) => !seen.has(r.id))];
      });
      setPaging({ page: paging.page + 1, total: d.total ?? paging.total, hasMore: Boolean(d.hasMore) });
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to load more requests.'));
    } finally {
      setLoadingMore(false);
    }
  }
  function chooseScope(next: Scope) {
    if (next === scope) return;
    setScope(next);
    setExpanded(null);
    setLoading(true);
    void load(next);
  }
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
      setScope('mine');
      await load('mine');
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
      const sent = await apiPost<{ conversationId?: string | null }>(`/urgent-requests/${reply.request.id}/respond`, {
        message: reply.message.trim(),
        rate: reply.rate.trim() ? Number(reply.rate) : null,
      });
      trackUrgentResponseSubmitted();
      toast.success('Availability sent', {
        action: sent?.conversationId
          ? { label: 'Open conversation', onClick: () => openThread(sent.conversationId) }
          : undefined,
      });
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
  const applyStatus = async (r: UrgentRequest, status: 'filled' | 'closed') => {
    await apiPatch(`/urgent-requests/${r.id}`, { status });
    toast.success(status === 'filled' ? 'Request marked filled' : 'Request closed');
    setExpanded(null);
    await load();
  };
  const closeRequest = (r: UrgentRequest, status: 'filled' | 'closed') =>
    ask({
      title: status === 'filled' ? 'Mark this request filled?' : 'Close this request?',
      description:
        status === 'filled'
          ? 'Use this when you filled it another way. To fill it with someone who replied, choose them from Responses instead. It stops appearing to musicians and cannot be reopened.'
          : 'It stops appearing to musicians and cannot be reopened.',
      confirmLabel: status === 'filled' ? 'Mark filled' : 'Close request',
      destructive: status === 'closed',
      action: () => applyStatus(r, status),
    });
  // Opens (or creates) the one conversation with this person and goes to it.
  async function messageResponder(response: UrgentRequestResponse) {
    try {
      const d = await apiPost<ConversationCreated>('/conversations', { candidateId: response.user_id });
      openThread(d.conversation.id);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to open the conversation.'));
    }
  }
  const acceptResponder = (r: UrgentRequest, response: UrgentRequestResponse) =>
    ask({
      title: `Choose ${response.name}?`,
      description: `This marks the request filled by ${response.name}. They are told they were chosen and you can message them to confirm the details. Nothing is posted publicly.`,
      confirmLabel: `Choose ${response.name}`,
      action: async () => {
        const d = await apiPost<{ conversationId?: string | null }>(`/urgent-requests/${r.id}/accept`, {
          userId: response.user_id,
        });
        toast.success(`Request filled by ${response.name}`, {
          action: d?.conversationId
            ? { label: 'Message them', onClick: () => openThread(d.conversationId) }
            : undefined,
        });
        setExpanded(null);
        await load();
      },
    });
  const statusLabel = (status: string) =>
    ({ open: 'Open', filled: 'Filled', expired: 'Expired', closed: 'Closed', cancelled: 'Closed' })[status] || status;
  const filter = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    void load();
  };
  const emptyTitle =
    city || role
      ? 'No open requests match these filters.'
      : scope === 'matches'
        ? 'No open requests match your roles and city right now.'
        : scope === 'mine'
          ? 'You have not posted an urgent need yet.'
          : 'No open urgent requests right now.';
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
        <div role="tablist" aria-label="Urgent requests" className="mt-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`urgent-tab-${tab.id}`}
              aria-selected={scope === tab.id}
              onClick={() => chooseScope(tab.id)}
              className={`min-h-9 rounded-full border px-4 text-sm ${
                scope === tab.id
                  ? 'border-violet-400 bg-violet-500/20 text-white'
                  : 'border-white/15 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
          <EmptyState icon={Siren} className="mt-7" title={emptyTitle}>
            {city || role
              ? 'Try a nearby city or a broader role.'
              : scope === 'matches'
                ? 'We alert you the moment one fits. Meanwhile, look at everything that is open.'
                : 'Post one when you need cover fast.'}
            {scope === 'matches' && !city && !role && (
              <Button className="mt-4" variant="outline" onClick={() => chooseScope('browse')}>
                See all open requests
              </Button>
            )}
          </EmptyState>
        ) : (
          <div className="grid gap-4 mt-7">
            {items.map((r) => (
              <Card key={r.id} className="bg-white/[.055] border-white/10">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <UserAvatar id={r.requester_id} name={r.requesterName || 'Requester'} size="md" />
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
                          {formatWhen(r.start_at)}
                        </p>
                        {Boolean(r.budget_min || r.budget_max) && (
                          <p className="text-sm text-emerald-300 mt-1">
                            Budget{' '}
                            {formatPay(
                              { currency: r.currency, compensation_min: r.budget_min, compensation_max: r.budget_max },
                              '',
                            )}
                          </p>
                        )}
                        {r.requirements && <p className="text-sm text-slate-300 mt-2 break-words">{r.requirements}</p>}
                        {Boolean(r.myMatchReasons?.length) && (
                          <p className="text-xs text-slate-500 mt-2">Why you: {r.myMatchReasons!.join(' · ')}</p>
                        )}
                        {r.status === 'filled' &&
                          (r.filled_by_id === user?.id ? (
                            <p className="text-sm text-emerald-300 mt-2">
                              You were chosen. Message them to confirm the details.
                            </p>
                          ) : r.myResponse ? (
                            <p className="text-sm text-slate-400 mt-2">Filled — thanks for responding</p>
                          ) : null)}
                      </div>
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
                            <Button variant="outline" onClick={() => closeRequest(r, 'filled')}>
                              Mark filled
                            </Button>
                            <Button variant="ghost" onClick={() => closeRequest(r, 'closed')}>
                              Close
                            </Button>
                          </>
                        )}
                      </div>
                    ) : user?.role === 'jobseeker' && r.status === 'open' ? (
                      <div className="flex flex-wrap gap-2 self-start">
                        {r.myResponse && r.conversationId && (
                          <Button variant="secondary" onClick={() => openThread(r.conversationId)}>
                            Message
                          </Button>
                        )}
                        <Button
                          variant={r.myResponse ? 'outline' : 'default'}
                          onClick={() => {
                            setFormError('');
                            setReply({ request: r, message: '', rate: '' });
                          }}
                          disabled={pending !== null}
                        >
                          {r.myResponse ? 'Update response' : 'I’m available'}
                        </Button>
                      </div>
                    ) : user?.role === 'jobseeker' && r.filled_by_id === user?.id && r.conversationId ? (
                      <Button className="self-start" variant="secondary" onClick={() => openThread(r.conversationId)}>
                        Message
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
                            <div className="flex items-center gap-3">
                              <UserAvatar
                                id={response.user_id}
                                name={response.name}
                                size="md"
                                photoUrl={response.photoUrl}
                              />
                              <div className="min-w-0">
                                <div className="font-medium">{response.name}</div>
                                <div className="text-sm text-violet-300">
                                  {response.headline || 'Music professional'}
                                </div>
                              </div>
                            </div>
                            {response.message && (
                              <p className="mt-2 text-sm text-slate-300 break-words">{response.message}</p>
                            )}
                            {response.rate != null && (
                              <p className="mt-1 text-sm text-emerald-300">
                                Rate: {formatMoney(response.rate, r.currency || 'INR')}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="secondary" onClick={() => void messageResponder(response)}>
                                Message
                              </Button>
                              {r.status === 'open' && (
                                <Button size="sm" variant="outline" onClick={() => acceptResponder(r, response)}>
                                  Accept
                                </Button>
                              )}
                              {r.status === 'filled' && r.filled_by_id === response.user_id && (
                                <Badge className="bg-emerald-500/15 text-emerald-200">Chosen</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                        {!(responses[r.id] || []).length && <p className="text-sm text-slate-500">No responses yet.</p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {paging.hasMore && (
              <div className="text-center">
                <p className="text-sm text-slate-400" role="status">
                  Showing {items.length} of {paging.total}
                </p>
                <Button className="mt-3" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            )}
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
          footerNote={`Expect a first response ${URGENT_PROMISE}.`}
          onSubmit={create}
        >
          <UrgentRequestFields values={urgent.values} errors={urgent.form.errors} onChange={urgent.set} />
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
        {confirmDialog}
      </main>
    </div>
  );
}
