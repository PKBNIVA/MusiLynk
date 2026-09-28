import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, MapPin, Send, Siren, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { errorMessage } from '../../lib/errors';
import { Panel, Empty } from './shared';
import { AdminPageHeader, AdminSelect, HowToCallout } from './ui';
import type { AdminUrgentRequest, UrgentCandidate, UrgentFunnel } from '../../lib/apiTypes';

// GET /api/admin/urgent-requests (Admin::UrgentRequestsController) — the founder's hand-matching
// screen for "need someone by tomorrow" (Mumbai first). Self-contained: it loads its own data
// rather than going through AdminDashboard's shared Data/SOURCES bag, so wiring it in is a
// one-line addition there (see AdminAiTab/OperationsTab for the same pattern).
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
] as const;

const relativeAge = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

function FunnelBar({ funnel }: { funnel: UrgentFunnel }) {
  const cells: { label: string; value: number }[] = [
    { label: 'Requests today', value: funnel.requestsToday },
    { label: 'Notified', value: funnel.notifiedToday },
    { label: 'Responded', value: funnel.respondedToday },
    { label: 'Filled within 24h', value: funnel.filledWithin24hToday },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {cells.map((c) => (
        <Card key={c.label} className="bg-white/[.05] border-white/10">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs text-slate-400 mt-1">{c.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function UrgentTab() {
  const [requests, setRequests] = useState<AdminUrgentRequest[]>([]);
  const [funnel, setFunnel] = useState<UrgentFunnel | null>(null);
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['value']>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, UrgentCandidate[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<{ requests: AdminUrgentRequest[]; funnel: UrgentFunnel }>(
        `/admin/urgent-requests?status=${status}&perPage=100`,
      );
      setRequests(d.requests || []);
      setFunnel(d.funnel);
      setError('');
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not load urgent requests.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleExpand(id: string) {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (candidates[id]) return;
    try {
      const d = await apiGet<{ candidates: UrgentCandidate[] }>(`/admin/urgent-requests/${id}/candidates`);
      setCandidates((c) => ({ ...c, [id]: d.candidates || [] }));
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not load candidates.'));
    }
  }

  async function notify(requestId: string, candidateUserId: string) {
    setBusy(`${requestId}:${candidateUserId}`);
    try {
      const d = await apiPost<{ sent: boolean }>(`/admin/urgent-requests/${requestId}/notify`, { candidateUserId });
      toast.success(d.sent ? 'Alert sent' : 'Already notified on every channel');
      setCandidates((c) => ({
        ...c,
        [requestId]: (c[requestId] || []).map((cand) =>
          cand.userId === candidateUserId ? { ...cand, alreadyNotified: true } : cand,
        ),
      }));
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not send this alert.'));
    } finally {
      setBusy(null);
    }
  }

  async function markStatus(
    request: AdminUrgentRequest,
    next: 'filled' | 'cancelled' | 'expired',
    filledByUserId?: string,
  ) {
    setBusy(request.id);
    try {
      await apiPatch(`/admin/urgent-requests/${request.id}`, { status: next, filledByUserId });
      toast.success(next === 'filled' ? 'Marked filled' : `Marked ${next}`);
      await load();
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not update this request.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveNotes(requestId: string) {
    const founderNotes = notes[requestId];
    if (founderNotes === undefined) return;
    setBusy(`notes:${requestId}`);
    try {
      await apiPatch(`/admin/urgent-requests/${requestId}`, { founderNotes });
      toast.success('Note saved');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not save this note.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <AdminPageHeader
        icon={Siren}
        title="Urgent matching"
        description={'"Need someone by tomorrow" — hand-match open requests and track the launch metrics.'}
      />
      <HowToCallout storageKey="urgent-tab">
        Rows in red haven't had a response 60 minutes after posting. Open a row to see the ranked candidate list and
        click <strong>Notify</strong> to alert one person directly, even if the automatic pass already ran.
      </HowToCallout>
      {funnel && <FunnelBar funnel={funnel} />}
      <div className="flex items-center gap-3 mb-4">
        <AdminSelect
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          options={STATUS_OPTIONS}
          aria-label="Status filter"
        />
      </div>
      <Panel error={error} onRetry={load} loading={loading}>
        {loading ? (
          <p className="text-slate-400 text-center py-10" role="status">
            Loading…
          </p>
        ) : requests.length === 0 ? (
          <Empty icon={Siren} text="No urgent requests match this filter." />
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <Card
                key={r.id}
                className={
                  r.noResponseAfterWindow ? 'bg-rose-500/[.08] border-rose-400/30' : 'bg-white/[.05] border-white/10'
                }
              >
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="capitalize bg-orange-500/15 text-orange-200">{r.status}</Badge>
                        {r.noResponseAfterWindow && (
                          <Badge className="bg-rose-500/20 text-rose-200">
                            <AlertTriangle size={12} className="mr-1" /> No response after 60m
                          </Badge>
                        )}
                        <span className="text-xs text-slate-500">Age {relativeAge(r.ageMinutes)}</span>
                      </div>
                      <h3 className="font-semibold mt-1.5">{r.title}</h3>
                      <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <MapPin size={13} /> {r.city} · {r.role_name} · by {r.requesterName} · {r.responseCount}{' '}
                        response
                        {r.responseCount === 1 ? '' : 's'} · {r.notified_count || 0} notified
                        {r.filledByName ? ` · filled by ${r.filledByName}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void toggleExpand(r.id)}>
                        {expanded === r.id ? 'Hide candidates' : 'Candidates'}
                      </Button>
                      {r.status === 'open' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === r.id}
                            onClick={() => void markStatus(r, 'filled')}
                          >
                            <Check size={13} className="mr-1" /> Mark filled
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === r.id}
                            onClick={() => void markStatus(r, 'expired')}
                          >
                            <X size={13} className="mr-1" /> Expire
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {expanded === r.id && (
                    <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Ranked candidates</h4>
                        {!candidates[r.id]?.length ? (
                          <p className="text-sm text-slate-500">No matching candidates yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {candidates[r.id].map((c) => (
                              <div
                                key={c.userId}
                                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 p-2.5"
                              >
                                <div className="min-w-0 text-sm">
                                  <span className="font-medium">{c.name}</span>{' '}
                                  {c.verified && (
                                    <Badge variant="secondary" className="ml-1">
                                      Verified
                                    </Badge>
                                  )}
                                  <div className="text-xs text-slate-500">
                                    {c.city || 'No city'} · score {c.score} · {c.reasons.join(', ') || 'no signal'}
                                    {c.lastActiveAt ? ` · active ${new Date(c.lastActiveAt).toLocaleDateString()}` : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {c.alreadyResponded && (
                                    <Badge className="bg-emerald-500/15 text-emerald-300">Responded</Badge>
                                  )}
                                  <Button
                                    size="sm"
                                    variant={c.alreadyNotified ? 'ghost' : 'outline'}
                                    disabled={busy === `${r.id}:${c.userId}`}
                                    onClick={() => void notify(r.id, c.userId)}
                                  >
                                    <Send size={12} className="mr-1.5" /> {c.alreadyNotified ? 'Re-notify' : 'Notify'}
                                  </Button>
                                  {r.status === 'open' && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => void markStatus(r, 'filled', c.userId)}
                                    >
                                      Filled by them
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`urgent-notes-${r.id}`} className="text-sm font-semibold mb-1.5 block">
                          Founder notes
                        </label>
                        <div className="flex gap-2">
                          <textarea
                            id={`urgent-notes-${r.id}`}
                            className="flex-1 min-h-16 rounded-lg bg-slate-900 border border-white/10 p-2 text-sm"
                            defaultValue={r.founder_notes || ''}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `notes:${r.id}`}
                            onClick={() => void saveNotes(r.id)}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
