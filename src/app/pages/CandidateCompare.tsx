import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { UserAvatar } from '../components/kit/UserAvatar';
import { Button } from '../components/ui/button';
import { WorkSamplePlayer } from '../components/WorkSamplePlayer';
import { ShieldCheck, MapPin, ArrowLeft, BookmarkCheck, BookmarkPlus, MessageSquare, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { useAuth } from '../lib/authContext';
import type { ComparedProfessional } from '../lib/apiTypes';
export default function CandidateCompare() {
  const [sp, setSp] = useSearchParams(),
    nav = useNavigate(),
    [people, setPeople] = useState<ComparedProfessional[]>([]),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false),
    { user } = useAuth();
  const backTo = user?.role === 'jobseeker' ? '/jobseeker/hiring/talent' : '/employer/candidates';
  const base = user?.role === 'jobseeker' ? '/jobseeker' : '/employer';
  const idsParam = sp.get('ids') || '';
  const ids = useMemo(
    () =>
      idsParam
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    [idsParam],
  );
  useEffect(() => {
    setError('');
    setLoaded(false);
    if (ids.length < 2) {
      setPeople([]);
      return;
    }
    apiGet<{ professionals?: ComparedProfessional[] }>(
      `/candidates/compare/list?ids=${encodeURIComponent(ids.join(','))}`,
    )
      .then((d) => {
        setPeople(d.professionals || []);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [ids]);
  // Takes one column out of the comparison (the address keeps the rest, so Back still works).
  const remove = (id: string) => setSp({ ids: ids.filter((x) => x !== id).join(',') }, { replace: true });
  async function message(p: ComparedProfessional) {
    try {
      const d = await apiPost<{ conversation: { id: string } }>('/conversations', { candidateId: p.id });
      nav(`${base}/messages?c=${d.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to open the conversation.'));
    }
  }
  async function toggleShortlist(p: ComparedProfessional) {
    try {
      if (p.shortlisted) await apiDelete(`/shortlists/${p.id}`);
      else await apiPost(`/shortlists/${p.id}`, {});
      setPeople((xs) => xs.map((x) => (x.id === p.id ? { ...x, shortlisted: !p.shortlisted } : x)));
      toast.success(p.shortlisted ? 'Removed from shortlist' : 'Added to talent shortlist');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to update your shortlist.'));
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 pt-28 pb-16">
        <Link to={backTo} className="text-sm text-slate-400">
          <ArrowLeft size={14} className="inline mr-1" />
          Back to talent
        </Link>
        <PageHeader title="Compare professionals" className="mt-4" />
        {ids.length < 2 && (
          <Card className="mt-7 bg-white/5 border-white/10">
            <CardContent className="p-8 text-center text-slate-400">
              Select two to four professionals from talent search to compare them here.
              <div>
                <Button asChild className="mt-4">
                  <Link to={backTo}>Choose professionals</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {error && (
          <div className="mt-6 text-rose-300" role="alert">
            {error}
          </div>
        )}
        {loaded && !error && people.length === 0 && (
          <p className="mt-7 text-slate-400">
            These profiles are no longer available to compare.{' '}
            <Link to={backTo} className="text-violet-300">
              Choose other professionals
            </Link>
          </p>
        )}
        <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-4 mt-7">
          {people.map((p) => (
            <Card key={p.id} className="bg-white/[.055] border-white/10" data-testid="compare-card">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    id={p.id}
                    name={p.name}
                    size="lg"
                    photoUrl={p.photoUrl}
                    demo={p.demo}
                    genres={p.genres}
                    eager
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">{p.name}</h2>
                      {p.verified && <ShieldCheck size={16} className="text-emerald-300" />}
                    </div>
                    <div className="text-violet-300 text-sm mt-1">{p.headline || 'Music professional'}</div>
                  </div>
                </div>
                {p.location && (
                  <div className="text-sm text-slate-400 mt-2">
                    <MapPin size={14} className="inline mr-1" />
                    {p.location}
                  </div>
                )}
                <Row k="Experience" v={p.yearsExperience ? `${p.yearsExperience} years` : '—'} />
                <Row k="Session rate" v={p.sessionRate ? formatMoney(p.sessionRate, p.currency || 'INR') : '—'} />
                <Row k="Show rate" v={p.showRate ? formatMoney(p.showRate, p.currency || 'INR') : '—'} />
                <Row k="Tour day" v={p.tourDayRate ? formatMoney(p.tourDayRate, p.currency || 'INR') : '—'} />
                <div className="mt-4">
                  <div className="text-xs uppercase text-slate-500">Roles & skills</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {uniqueTags([...(p.roles || []), ...(p.instruments || []), ...(p.skills || [])])
                      .slice(0, 12)
                      .map((x: string) => (
                        <Badge key={x} variant="secondary">
                          {x}
                        </Badge>
                      ))}
                  </div>
                </div>
                <div className="mt-4 text-sm text-slate-300 space-y-1">
                  {p.remoteRecording && <div>✓ Remote recording</div>}
                  {p.sightReading && <div>✓ Sight-reading</div>}
                  {p.travelsNationally && <div>✓ National travel</div>}
                  {p.passportReady && <div>✓ Passport ready</div>}
                </div>
                <div className="mt-5">
                  <div className="text-xs uppercase text-slate-500 mb-2">Next availability</div>
                  {p.availability?.length ? (
                    p.availability.slice(0, 3).map((a) => (
                      <div key={a.startAt} className="text-xs text-slate-300 py-1">
                        {formatDate(a.startAt)} · {a.status}
                        {a.city ? ` · ${a.city}` : ''}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500">No published availability</div>
                  )}
                </div>
                <div className="mt-5 space-y-2">
                  {p.portfolio?.slice(0, 3).map((s) => (
                    <WorkSamplePlayer key={s.id} sample={s} compact />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => void message(p)}>
                    <MessageSquare aria-hidden="true" size={15} className="mr-1.5" />
                    Message
                  </Button>
                  <Button variant="outline" aria-pressed={!!p.shortlisted} onClick={() => void toggleShortlist(p)}>
                    {p.shortlisted ? (
                      <BookmarkCheck aria-hidden="true" size={15} className="mr-1.5 text-violet-300" />
                    ) : (
                      <BookmarkPlus aria-hidden="true" size={15} className="mr-1.5" />
                    )}
                    {p.shortlisted ? 'Shortlisted' : 'Shortlist'}
                  </Button>
                </div>
                <Button className="w-full mt-2" asChild>
                  <Link to={`/professionals/${p.id}`}>Open full profile</Link>
                </Button>
                <Button
                  variant="ghost"
                  className="w-full mt-2 text-slate-400"
                  aria-label={`Remove ${p.name} from the comparison`}
                  aria-disabled={people.length <= 2}
                  title={people.length <= 2 ? 'A comparison needs at least two musicians' : undefined}
                  onClick={() => {
                    if (people.length > 2) remove(p.id);
                  }}
                >
                  <X aria-hidden="true" size={15} className="mr-1.5" />
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
/** Each tag once, however it is cased ("Tabla" listed as a role and as a skill). */
function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/10 py-2 text-sm mt-2">
      <span className="text-slate-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}
