import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth, Role } from '../lib/authContext';
import { hasAccessToken } from '../lib/api';
import { IS_ADMIN_SITE, signInPath } from '../lib/appTarget';
import { Button } from './ui/button';
import { PageLoading } from './ExperienceStates';

const ROLE_LABEL: Record<string, string> = { employer: 'hirers', jobseeker: 'musicians', admin: 'admins' };
export function ProtectedRoute({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading label="Restoring your workspace" />;
  if (!user && hasAccessToken())
    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-slate-950 px-5 text-white">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">We couldn't reach MusiLynk</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your session is still saved. Check your connection and try again.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button
              onClick={() => {
                refresh();
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.assign('/');
              }}
            >
              Go home
            </Button>
          </div>
        </div>
      </div>
    );
  if (!user) {
    const authRole = roles.includes('employer') && !roles.includes('jobseeker') ? 'employer' : 'jobseeker';
    return <Navigate to={signInPath(authRole)} state={{ from: `${location.pathname}${location.search}` }} replace />;
  }
  if (!roles.includes(user.role)) {
    /* Each site has one home per role; the other site's role goes to this site's front page. */
    const home = IS_ADMIN_SITE || user.role === 'admin' ? '/' : user.role === 'employer' ? '/employer' : '/jobseeker';
    return <WrongRoleRedirect home={home} roles={roles} />;
  }
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}

/** Every signed-in workspace (/jobseeker, /employer) is kept out of search results while it's
 * mounted; the robots tag is restored to whatever it was when the visitor leaves. */
function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'robots';
      document.head.appendChild(tag);
    }
    const previous = tag.content;
    tag.content = 'noindex, nofollow';
    return () => {
      tag.content = previous;
    };
  }, []);
  return <>{children}</>;
}

/** A page meant for a different role redirects the visitor home; this says why, once, instead of a silent bounce. */
function WrongRoleRedirect({ home, roles }: { home: string; roles: Role[] }) {
  useEffect(() => {
    const audience = roles.length === 1 ? ROLE_LABEL[roles[0]] || `${roles[0]}s` : 'a different kind of account';
    // ProtectedRoute sits in the eagerly-loaded route tree; sonner is otherwise kept out of the
    // entry bundle (see App.tsx's lazy Toaster), so this toast is loaded on demand too.
    import('sonner').then(({ toast }) => toast.error(`That page is for ${audience} — here's your dashboard.`));
    // Shown once per redirect, not once per audience string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Navigate to={home} replace />;
}
