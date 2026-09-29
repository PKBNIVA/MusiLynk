import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { usePageMeta } from '../components/PageMeta';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Field, textareaClass } from '../components/booking/BookingDialogs';
import { AutocompleteInput } from '../components/ai/AutocompleteInput';
import { apiGet, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../lib/authContext';
import { saveUrgentDraft, type UrgentDraft } from '../lib/urgentDraft';
import { toast } from 'sonner';
import { CheckCircle2, Clock3, MessageCircle, Siren, Zap } from 'lucide-react';
import type { UrgentRequest, UrgentRequestResponse } from '../lib/apiTypes';

// Tomorrow, 6pm local: the default "when" for a request titled "need someone by tomorrow".
function defaultStartAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type Confirmed = { id: string; notifiedCount: number; responseTimePromise: string };
// Passed via navigate(..., { state }) either directly (signed-in submit) or after the
// sign-up hop completes and AuthPage submits the saved draft on this person's behalf.
type LocationState = { confirmed?: Confirmed } | null;

export default function UrgentHire() {
  usePageMeta(
    'Need someone by tomorrow?',
    'Post an urgent music hiring request and get matched with available, verified musicians and crew near you within hours.',
    { canonicalPath: '/urgent' },
  );
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmed, setConfirmed] = useState<Confirmed | null>((location.state as LocationState)?.confirmed || null);
  const [roles, setRoles] = useState<string[]>([]),
    [city, setCity] = useState(['Mumbai']),
    [venue, setVenue] = useState(''),
    [startAt, setStartAt] = useState(defaultStartAt()),
    [budgetMin, setBudgetMin] = useState(''),
    [budgetMax, setBudgetMax] = useState(''),
    [note, setNote] = useState(''),
    [genres, setGenres] = useState<string[]>([]),
    [error, setError] = useState(''),
    [submitting, setSubmitting] = useState(false);

  const problem = useMemo(() => {
    if (!roles[0]?.trim() || !city[0]?.trim() || !startAt) return 'Add the role, city and when you need them.';
    if (new Date(startAt).getTime() < Date.now() - 60_000) return 'Choose a time that has not already passed.';
    for (const v of [budgetMin, budgetMax])
      if (v.trim() && !/^\d+$/.test(v.trim())) return 'Budgets must be whole numbers.';
    if (budgetMin.trim() && budgetMax.trim() && Number(budgetMax) < Number(budgetMin))
      return 'Maximum budget must be at least the minimum.';
    return '';
  }, [roles, city, startAt, budgetMin, budgetMax]);

  function draftPayload(): UrgentDraft {
    return {
      title: `${roles[0]} needed in ${city[0]}`,
      roleName: roles[0],
      city: city[0],
      venue: venue.trim() || undefined,
      startAt: new Date(startAt).toISOString(),
      budgetMin: budgetMin.trim() || undefined,
      budgetMax: budgetMax.trim() || undefined,
      note: note.trim() || undefined,
      genres: genres.length ? genres : undefined,
    };
  }

  async function submit() {
    if (problem) return setError(problem);
    setError('');
    const draft = draftPayload();
    if (!user) {
      // Sign-in gated at submit: the draft survives the hop through the two-minute join flow (or
      // sign-in for existing hirers) and is submitted the moment they're signed in.
      saveUrgentDraft(draft);
      toast.message("Create a free hirer account and we'll post this right away.");
      navigate('/join/hiring');
      return;
    }
    setSubmitting(true);
    try {
      const requirements = [draft.venue && `Venue/studio: ${draft.venue}`, draft.note].filter(Boolean).join('\n');
      const d = await apiPost<{ id: string; notifiedCount: number; responseTimePromise: string }>('/urgent-requests', {
        title: draft.title,
        roleName: draft.roleName,
        city: draft.city,
        startAt: draft.startAt,
        budgetMin: draft.budgetMin ? Number(draft.budgetMin) : null,
        budgetMax: draft.budgetMax ? Number(draft.budgetMax) : null,
        requirements: requirements || null,
        genre: draft.genres?.join(', ') || null,
      });
      setConfirmed({ id: d.id, notifiedCount: d.notifiedCount, responseTimePromise: d.responseTimePromise });
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not publish this request. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-2xl mx-auto px-4 sm:px-5 pt-28 pb-20">
        {confirmed ? (
          <StatusCard confirmed={confirmed} onNewRequest={() => setConfirmed(null)} />
        ) : (
          <>
            <p className="text-xs uppercase tracking-[.22em] text-orange-300 flex items-center gap-2">
              <Siren size={14} /> Need someone by tomorrow
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold mt-2">Find a verified musician, fast.</h1>
            <p className="text-slate-400 mt-2">
              Tell us who you need and where. We notify verified musicians nearby right away — most requests get a first
              response within 2 hours.
            </p>
            <Card className="bg-white/[.055] border-white/10 mt-7">
              <CardContent className="p-5 sm:p-6 space-y-4">
                {error && (
                  <p role="alert" className="text-sm text-rose-300">
                    {error}
                  </p>
                )}
                <AutocompleteInput
                  id="urgent-role"
                  field="roles"
                  label="Role needed"
                  multiple={false}
                  values={roles}
                  onChange={setRoles}
                  placeholder="Drummer, wedding singer, live sound engineer…"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date & time" htmlFor="urgent-start">
                    <Input
                      id="urgent-start"
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                  </Field>
                  <AutocompleteInput
                    id="urgent-city"
                    field="cities"
                    label="City"
                    multiple={false}
                    values={city}
                    onChange={setCity}
                  />
                </div>
                <Field label="Venue or studio (optional)" htmlFor="urgent-venue">
                  <Input
                    id="urgent-venue"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="e.g. Blue Frog, Lower Parel"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Budget min (INR)" htmlFor="urgent-budget-min">
                    <Input
                      id="urgent-budget-min"
                      type="number"
                      min="0"
                      value={budgetMin}
                      onChange={(e) => setBudgetMin(e.target.value)}
                    />
                  </Field>
                  <Field label="Budget max (INR)" htmlFor="urgent-budget-max">
                    <Input
                      id="urgent-budget-max"
                      type="number"
                      min="0"
                      value={budgetMax}
                      onChange={(e) => setBudgetMax(e.target.value)}
                    />
                  </Field>
                </div>
                <AutocompleteInput
                  id="urgent-genres"
                  field="genres"
                  label="Genres (optional)"
                  values={genres}
                  onChange={setGenres}
                />
                <Field label="Short note (optional)" htmlFor="urgent-note">
                  <textarea
                    id="urgent-note"
                    className={textareaClass}
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Anything they should know before saying yes—set list, dress code, load-in time."
                  />
                </Field>
                <Button className="w-full" size="lg" disabled={submitting} onClick={() => void submit()}>
                  <Zap size={16} className="mr-2" />
                  {submitting ? 'Publishing…' : user ? 'Post urgent need' : 'Continue to sign up'}
                </Button>
                {!user && (
                  <p className="text-xs text-slate-500 text-center">
                    We'll save this and post it the moment your free hirer account is ready.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function StatusCard({ confirmed, onNewRequest }: { confirmed: Confirmed; onNewRequest: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [item, setItem] = useState<UrgentRequest | null>(null);
  const [responses, setResponses] = useState<UrgentRequestResponse[]>([]);

  const refresh = useCallback(async () => {
    try {
      const d = await apiGet<{ request: UrgentRequest }>(`/urgent-requests/${confirmed.id}`);
      setItem(d.request);
      if ((d.request.responseCount || 0) > 0) {
        const r = await apiGet<{ responses?: UrgentRequestResponse[] }>(`/urgent-requests/${confirmed.id}/responses`);
        setResponses(r.responses || []);
      }
    } catch {
      /* the status card degrades gracefully to the confirmation numbers we already have */
    }
  }, [confirmed.id]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function message(userId: string) {
    try {
      const d = await apiPost<{ conversation: { id: string } }>('/conversations', { candidateId: userId });
      navigate(`${user?.role === 'jobseeker' ? '/jobseeker' : '/employer'}/messages?conversation=${d.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  const notifiedCount = item?.notified_count ?? confirmed.notifiedCount;
  const responseCount = item?.responseCount ?? 0;

  return (
    <Card className="bg-gradient-to-br from-emerald-500/10 to-violet-500/[.06] border-emerald-400/20">
      <CardContent className="p-6 sm:p-8">
        <Badge className="bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 size={13} className="mr-1" /> We're on it
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-bold mt-3">Your urgent request is live.</h1>
        <p className="text-slate-300 mt-2 flex items-center gap-1.5">
          <Clock3 size={15} /> Expect your first response {confirmed.responseTimePromise}.
        </p>
        <div className="grid grid-cols-2 gap-3 mt-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-center">
            <div className="text-2xl font-bold">{notifiedCount}</div>
            <div className="text-xs text-slate-400 mt-1">Musicians notified</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-center">
            <div className="text-2xl font-bold">{responseCount}</div>
            <div className="text-xs text-slate-400 mt-1">Responses so far</div>
          </div>
        </div>
        {responses.length > 0 && (
          <div className="mt-6 space-y-2">
            <h2 className="font-semibold">Who's available</h2>
            {responses.map((r) => (
              <div
                key={r.user_id}
                className="rounded-xl border border-white/10 bg-black/15 p-3 flex justify-between items-center gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.headline && <div className="text-sm text-violet-300 truncate">{r.headline}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => void message(r.user_id)}>
                  <MessageCircle size={14} className="mr-1.5" /> Message
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-7">
          <Button
            variant="outline"
            onClick={() => navigate(user?.role === 'jobseeker' ? '/jobseeker/urgent' : '/employer/urgent')}
          >
            Manage all urgent requests
          </Button>
          <Button variant="ghost" onClick={onNewRequest}>
            Post another
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
