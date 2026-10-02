import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CheckCircle2, Music, XCircle } from 'lucide-react';
import { PublicNav } from '../components/PublicNav';
import { Button } from '../components/ui/button';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import type { ActInviteForMe } from '../lib/apiTypes';

type Answer = 'accepted' | 'declined' | null;

/** The page an invite link opens (/invites/:token). A stranger is sent through sign-in or sign-up and
 * lands back here; joining the lineup only ever happens when the signed-in musician taps Accept. */
export default function ActInvite() {
  const { token = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [invite, setInvite] = useState<ActInviteForMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [answer, setAnswer] = useState<Answer>(null);
  const [error, setError] = useState('');

  // An invite link is private to whoever it was sent to: keep it out of search results.
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, nofollow';
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  useEffect(() => {
    let live = true;
    apiGet<{ invite: ActInviteForMe }>(`/act-invites/preview?token=${encodeURIComponent(token)}`)
      .then((d) => live && setInvite(d.invite))
      .catch((e: unknown) => live && setLoadError(errorMessage(e, "We couldn't open this invite.")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [token]);

  async function respond(kind: 'accept' | 'decline') {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await apiPost(kind === 'accept' ? '/act-invites/accept' : '/act-invites/decline', { token });
      setAnswer(kind === 'accept' ? 'accepted' : 'declined');
    } catch (e: unknown) {
      setError(errorMessage(e, 'Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const from = `/invites/${token}`;
  const closed = invite && invite.status !== 'pending';
  const role = invite ? `${invite.roleName}${invite.instrument ? ` (${invite.instrument})` : ''}` : '';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-lg px-4 pb-16 pt-28 text-center sm:px-5 sm:pt-32">
        {loading || authLoading ? (
          <p role="status" className="text-slate-400">
            Opening your invite…
          </p>
        ) : loadError || !invite ? (
          <>
            <XCircle className="mx-auto text-rose-300" size={40} />
            <h1 className="mt-4 text-2xl font-semibold">This invite link isn't valid</h1>
            <p className="mt-2 text-slate-400">{loadError || 'Ask the band to send you a new one.'}</p>
          </>
        ) : answer === 'accepted' ? (
          <>
            <CheckCircle2 className="mx-auto text-emerald-300" size={40} />
            <h1 className="mt-4 text-2xl font-semibold">You're in {invite.actName}</h1>
            <p className="mt-2 text-slate-400">You've joined the lineup as {role}.</p>
            <Button asChild className="mt-6">
              <Link to="/jobseeker/acts">Go to your acts</Link>
            </Button>
          </>
        ) : answer === 'declined' ? (
          <>
            <CheckCircle2 className="mx-auto text-slate-300" size={40} />
            <h1 className="mt-4 text-2xl font-semibold">Invite declined</h1>
            <p className="mt-2 text-slate-400">
              We've let {invite.inviterName} know. Nothing was changed on your account.
            </p>
          </>
        ) : (
          <>
            <Music className="mx-auto text-violet-300" size={40} />
            <h1 className="mt-4 text-2xl font-semibold">
              {invite.inviterName} invited you to join {invite.actName}
            </h1>
            <p className="mt-2 text-slate-300">As {role}.</p>
            {invite.city && <p className="text-sm text-slate-400">Based in {invite.city}</p>}
            {closed ? (
              <p role="status" className="mt-6 rounded-xl bg-white/[.055] p-4 text-slate-300">
                {invite.status === 'expired'
                  ? 'This invite has expired. Ask the band to send a new one.'
                  : invite.status === 'revoked'
                    ? 'The band cancelled this invite.'
                    : 'This invite has already been answered.'}
              </p>
            ) : !user ? (
              <>
                <p className="mt-6 text-sm text-slate-400">
                  Sign in or create a free musician account to answer. You're only added if you accept.
                </p>
                <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button asChild>
                    <Link to="/auth/jobseeker" state={{ from }}>
                      Sign in to answer
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/join/musician" state={{ from }}>
                      Create an account
                    </Link>
                  </Button>
                </div>
              </>
            ) : user.role !== 'jobseeker' ? (
              <p role="alert" className="mt-6 rounded-xl bg-white/[.055] p-4 text-slate-300">
                Band invites are for musician accounts. Sign in with the musician account you were invited on.
              </p>
            ) : (
              <>
                <p className="mt-6 text-sm text-slate-400">
                  Signed in as {user.name}. You're only added if you accept.
                </p>
                {error && (
                  <p role="alert" className="mt-3 text-sm text-rose-300">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button onClick={() => void respond('accept')} disabled={Boolean(busy)} aria-busy={busy === 'accept'}>
                    {busy === 'accept' ? 'Joining…' : 'Accept and join'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void respond('decline')}
                    disabled={Boolean(busy)}
                    aria-busy={busy === 'decline'}
                  >
                    {busy === 'decline' ? 'Declining…' : 'Decline'}
                  </Button>
                </div>
              </>
            )}
            {!closed && <p className="mt-6 text-xs text-slate-500">Expires on {formatDate(invite.expiresAt)}.</p>}
          </>
        )}
      </main>
    </div>
  );
}
