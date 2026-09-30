import { DemoBadge } from '../../components/DemoBadge';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PublicNav } from '../../components/PublicNav';
import { PublicDetailState } from '../../components/PublicDetailState';
import { usePageMeta } from '../../components/PageMeta';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { apiGet, apiPost } from '../../lib/api';
import { trackProfileView } from '../../lib/analytics';
import { personLines } from '../../lib/personLine';
import { MapPin, MessageSquare, ShieldCheck, Flag, Zap } from 'lucide-react';
import { MediaTile } from '../../components/showcase/MediaTile';
import { PlayChip } from '../../components/kit/PlayChip';
import { UserAvatar } from '../../components/kit/UserAvatar';
import { ReportDialog } from '../../components/ReportDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { VerifiedBadge, verifiedBadgeCopy } from '../../components/VerifiedBadge';
import { useAuth } from '../../lib/authContext';
import { errorMessage, errorStatus } from '../../lib/errors';
import type { PortfolioItem, Professional } from '../../lib/apiTypes';

/** Person structured data for a public professional profile. */
function personJsonLd(p: Professional, id?: string) {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.name,
    url: `/professionals/${id}`,
  };
  if (p.headline) ld.jobTitle = p.headline;
  if (p.location) ld.address = { '@type': 'PostalAddress', addressLocality: p.location };
  if (p.bio) ld.description = p.bio;
  return ld;
}

export default function PublicProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<{ professional: Professional; portfolio: PortfolioItem[] }>(),
    [loading, setLoading] = useState(true),
    [reporting, setReporting] = useState(false),
    [bioOpen, setBioOpen] = useState(false),
    [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setD(
        await apiGet<{ professional: Professional; portfolio: PortfolioItem[] }>(
          `/public/talent/${encodeURIComponent(id || '')}`,
        ),
      );
    } catch (e: unknown) {
      setD(undefined);
      setError({ message: errorMessage(e, 'Unable to load this profile.'), status: errorStatus(e) });
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const p = d?.professional;
  useEffect(() => {
    if (p?.id) trackProfileView(p.id);
  }, [p?.id]);
  usePageMeta(
    p?.name && `${p.name}${p.headline ? ` — ${p.headline}` : ''}`,
    p ? p.bio || `${p.name} on Verse${p.location ? `, ${p.location}` : ''}.` : undefined,
    { canonicalPath: `/professionals/${id}`, type: 'profile', jsonLd: p ? personJsonLd(p, id) : undefined },
  );
  if (loading || error || !p)
    return (
      <PublicDetailState
        loading={loading}
        error={error || (!loading && !p ? { message: 'Not found', status: 404 } : null)}
        noun="profile"
        backTo="/music-professionals"
        backLabel="Browse professionals"
        onRetry={() => void load()}
      />
    );
  const c = d.professional;
  const samples = d.portfolio || [];
  const capabilities = [
    c.remoteRecording && 'Remote recording',
    c.sightReading && 'Sight-reading',
    c.travelsNationally && 'Travels nationally',
    c.passportReady && 'Passport ready',
  ].filter((x): x is string => Boolean(x));
  const heroLine = personLines({ ...c, location: null });
  const longBio = (c.bio || '').length > 200;
  async function message() {
    try {
      const r = await apiPost<{ conversation: { id: string } }>('/conversations', { candidateId: c.id });
      nav(`${user?.role === 'jobseeker' ? '/jobseeker' : '/employer'}/messages?conversation=${r.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  const actions = user ? (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void message()}>
        <MessageSquare size={16} aria-hidden="true" className="mr-2" />
        Message
      </Button>
      {user.role !== 'admin' && (
        <Button variant="outline" asChild>
          <Link to={`${user.role === 'jobseeker' ? '/jobseeker' : '/employer'}/book-talent`}>Request a quote</Link>
        </Button>
      )}
    </div>
  ) : (
    <Button asChild>
      <Link to="/auth/employer" state={{ from: `/professionals/${id}` }}>
        Sign in to hire or message
      </Link>
    </Button>
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-5xl px-5 pb-28 pt-12 lg:pb-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <header className="flex items-start gap-4 sm:gap-5" data-testid="profile-hero">
              <UserAvatar id={c.id} name={c.name} size="xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold break-words md:text-4xl">{c.name}</h1>
                  <DemoBadge show={c.demo} />
                  {c.verified && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ShieldCheck
                          className="text-emerald-300"
                          aria-label={verifiedBadgeCopy(c.verification)}
                          tabIndex={0}
                        />
                      </TooltipTrigger>
                      <TooltipContent>{verifiedBadgeCopy(c.verification)}</TooltipContent>
                    </Tooltip>
                  )}
                  {c.verified && c.verificationTier === 'verified_pro' && (
                    <VerifiedBadge verification={c.verification} tier={c.verificationTier} />
                  )}
                </div>
                {heroLine.primary && <p className="mt-1 text-lg text-violet-300">{heroLine.primary}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-400">
                  {heroLine.secondary.filter((x) => x !== c.location).length > 0 && (
                    <span>{heroLine.secondary.filter((x) => x !== c.location).join(' · ')}</span>
                  )}
                  {c.location && (
                    <span className="inline-flex items-center">
                      <MapPin size={15} aria-hidden="true" className="mr-1" />
                      {c.location}
                    </span>
                  )}
                  {(c.reviewsCount ?? 0) > 0 && (
                    <span>
                      {c.reviewsAverage?.toFixed(1)} · {c.reviewsCount} {c.reviewsCount === 1 ? 'review' : 'reviews'}
                    </span>
                  )}
                  {c.fastResponderBadge && (
                    <span className="inline-flex items-center gap-1 text-amber-200">
                      <Zap aria-hidden="true" size={12} />
                      Fast responder
                    </span>
                  )}
                </p>
                {capabilities.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {capabilities.map((x) => (
                      <Badge key={x} variant="outline" className="border-white/15 text-slate-300">
                        {x}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {samples.length ? (
                    samples.slice(0, 3).map((x) => <PlayChip key={x.id} sample={x} />)
                  ) : (
                    <span className="text-sm text-slate-400">No samples yet</span>
                  )}
                </div>
              </div>
            </header>
            {c.bio && (
              <section className="mt-8">
                <p
                  className={`text-slate-300 leading-7 whitespace-pre-line [overflow-wrap:anywhere] ${
                    bioOpen ? '' : 'line-clamp-3'
                  }`}
                >
                  {c.bio}
                </p>
                {longBio && (
                  <button
                    type="button"
                    aria-expanded={bioOpen}
                    className="mt-1 text-sm text-violet-300 hover:text-violet-200"
                    onClick={() => setBioOpen(!bioOpen)}
                  >
                    {bioOpen ? 'Less' : 'More'}
                  </button>
                )}
              </section>
            )}
            {c.credits?.length > 0 && (
              <section className="mt-8">
                <h2 className="font-semibold">Selected credits</h2>
                <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-slate-300 sm:grid-cols-2">
                  {c.credits.map((x: string) => (
                    <li key={x} className="[overflow-wrap:anywhere]">
                      {x}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="mt-8">
              <h2 className="font-semibold">Work samples</h2>
              {samples.length ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {samples.map((x) => (
                    <figure key={x.id}>
                      <MediaTile item={x} />
                      <figcaption className="mt-1 truncate text-xs text-slate-400">{x.title}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">No public work samples yet.</p>
              )}
            </section>
            <div className="mt-8">
              {user ? (
                <Button variant="ghost" size="sm" onClick={() => setReporting(true)}>
                  <Flag size={15} aria-hidden="true" className="mr-2" />
                  Report profile
                </Button>
              ) : (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/auth/employer" state={{ from: `/professionals/${id}` }}>
                    Sign in to report this profile
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <aside className="hidden lg:block">
            <div
              className="sticky top-24 rounded-2xl border border-white/10 bg-white/[.055] p-5"
              data-testid="profile-aside"
            >
              <h2 className="font-semibold">Book or message</h2>
              <div className="mt-4">{actions}</div>
              {c.responseTimeMinutes != null && (
                <p className="mt-3 text-xs text-slate-400">Usually replies within {c.responseTimeMinutes} minutes</p>
              )}
            </div>
          </aside>
        </div>
      </main>
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/95 p-3 backdrop-blur lg:hidden"
        data-testid="profile-bottom-bar"
      >
        {actions}
      </div>
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        title="Report this profile"
        description="Tell our moderators what is wrong with this profile."
        onSubmit={({ reason, details }) =>
          apiPost('/reports', { entityType: 'user', entityId: c.id, reason, ...(details ? { details } : {}) })
        }
      />
    </div>
  );
}
