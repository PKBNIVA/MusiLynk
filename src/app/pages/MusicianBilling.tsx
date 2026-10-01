import { Link } from 'react-router';
import { UserAvatar } from '../components/kit/UserAvatar';
import { useAuth } from '../lib/authContext';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { usePageMeta } from '../components/PageMeta';

/**
 * Billing for a musician. Verse is free for musicians during the beta, so there is nothing to
 * buy here and no hirer plans to show. (Hirers, and musicians who also hire, use /employer/billing.)
 */
export default function MusicianBilling() {
  const { user } = useAuth();
  usePageMeta('Plan & billing', 'Verse is free for musicians during the beta.');
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-3xl px-5 pb-16 pt-28">
        <PageHeader title="Plan & billing" />
        <section
          aria-labelledby="free-beta"
          data-testid="free-during-beta"
          className="flex gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[.06] p-5"
        >
          <UserAvatar
            id={user?.id || 'me'}
            name={user?.name || 'You'}
            size="xl"
            photoUrl={user?.photoUrl}
            art={!user?.photoUrl}
            eager
          />
          <div>
            <h2 id="free-beta" className="text-lg font-semibold">
              Free during beta
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Your profile, work, applications and messages cost nothing. We will tell you well before that changes.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/jobseeker/library">Add your work</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
