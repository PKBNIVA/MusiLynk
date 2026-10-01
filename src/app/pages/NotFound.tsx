import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { usePageMeta } from '../components/PageMeta';

// The public site's 404 has the marketplace nav and links; the admin site shares this route file but
// must not ship any of them, so that part is only ever imported (and emitted) by the public build.
// The test is written out here, not imported as IS_ADMIN_SITE: only a literal comparison is folded at
// build time (see routes.tsx), which is what keeps the import out of the admin bundle.
const NotFoundPublic =
  import.meta.env.VITE_APP_TARGET === 'admin' ? null : lazy(() => import('../components/landing/NotFoundPublic'));

export default function NotFound() {
  usePageMeta(
    'Page not found',
    'This Verse page does not exist. Search opportunities, musicians and bookable acts instead.',
    { noindex: true },
  );
  if (NotFoundPublic) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <NotFoundPublic />
      </Suspense>
    );
  }
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-center text-white">
      <div>
        <p aria-hidden="true" className="text-7xl font-black text-violet-300">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold">Page not found</h1>
        <p className="mt-3 text-slate-300">That page does not exist on this site.</p>
        <Link to="/" className="mt-6 inline-block rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-950">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
