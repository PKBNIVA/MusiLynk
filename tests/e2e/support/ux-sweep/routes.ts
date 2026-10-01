import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Route enumeration for the UX sweep. Nothing here is hand-picked: every route comes from parsing
// src/app/routes.tsx (and the admin console tabs from src/app/pages/admin/shared.tsx), so a route added
// later is picked up automatically. Only the values that fill :params are chosen (from the seeded data).

const repoFile = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

export type Audience = 'public' | 'jobseeker' | 'employer' | 'shared' | 'admin';

export interface RoutePattern {
  /** The path as declared, with :params, e.g. /professionals/:id. */
  pattern: string;
  audience: Audience;
  /** The route only redirects (a <Redirect> element): probed, not photographed. */
  redirect?: boolean;
  /** Why the route cannot be captured on this build, if it cannot. */
  skipReason?: string;
}

export interface Ids {
  accounts: { newMusician: string; musician: string; newHirer: string; hirer: string; admin: string };
  musicianId: string;
  demoMusicianId: string;
  hirerId: string;
  actId: string;
  jobId: string;
  otherJobId: string;
  conversationId: string;
  portfolioSlug: string;
  portfolioId: string;
  postId: string;
  postAuthorType: string;
  postAuthorId: string;
  tag: string;
  invoiceId: string;
  urgentId: string;
  pagesType: string;
  pagesId: string;
  bookingId: string;
}

export function loadIds(): Ids {
  const file = process.env.UX_IDS || '/home/user/ux-stack/ids.json';
  if (!existsSync(file)) {
    throw new Error(
      `No ids file at ${file}. Run: cd backend && bin/rails runner ../tests/e2e/support/ux-sweep/ids.rb ${file}`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Ids;
}

const FEATURE_OFF_RESUMES =
  'Resumes are switched off in production (VITE_FEATURE_RESUMES is not "true"), so the route is not served.';
const RESUME_PAGES = ['career', 'resumes', 'resumes/:id', 'resumes/:id/print'];

/** Every public-site route in src/app/routes.tsx, with the audience it is meant for. */
export function enumeratePublicRoutes(): RoutePattern[] {
  const source = readFileSync(repoFile('src/app/routes.tsx'), 'utf8');
  const start = source.indexOf('function publicRoutes');
  const end = source.indexOf('function adminRoutes');
  const body = source.slice(start, end);

  const out: RoutePattern[] = [];
  const add = (route: RoutePattern) => {
    if (!out.some((existing) => existing.pattern === route.pattern)) out.push(route);
  };

  // Showcase paths are declared once and mounted under both /jobseeker and /employer.
  const block = /const showcasePaths = \{([\s\S]*?)\} as const/.exec(body)?.[1] ?? '';
  const showcase = [...block.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => ({ key: m[1], path: m[2] }));

  // Walk the `path: '...'` declarations in source order: an absolute path starts a new section, relative
  // ones belong to the last absolute one (the /jobseeker and /employer children).
  let base = '';
  const re = /path:\s*'([^']+)'(?=([\s\S]{0,160}))/g;
  for (const match of body.matchAll(re)) {
    const [, path, after] = match;
    const redirect = /<Redirect/.test(after.split('path:')[0]);
    if (path.startsWith('/')) {
      base = path === '/jobseeker' || path === '/employer' ? path : '';
      const audience: Audience =
        path === '/jobseeker'
          ? 'jobseeker'
          : path === '/employer'
            ? 'employer'
            : path.startsWith('/stage')
              ? 'shared'
              : 'public';
      if (path === '*') continue;
      if (path === '/jobseeker' || path === '/employer') {
        add({ pattern: path, audience });
        continue;
      }
      add({ pattern: path, audience, redirect });
    } else if (base) {
      add({ pattern: `${base}/${path}`, audience: base === '/jobseeker' ? 'jobseeker' : 'employer', redirect });
    }
  }

  // Public showcase pages: ['/p/:slug', 'publicPortfolio'], ['/pages/:type/:id', 'pageJobs'].
  for (const m of body.matchAll(/\['(\/[^']+)',\s*'\w+'\]/g)) add({ pattern: m[1], audience: 'public' });

  for (const role of ['jobseeker', 'employer'] as const) {
    for (const { key, path } of showcase) {
      if (role === 'employer' && key === 'library') continue;
      const resume = RESUME_PAGES.includes(path);
      add({
        pattern: `/${role}/${path}`,
        audience: role,
        skipReason: resume ? FEATURE_OFF_RESUMES : undefined,
      });
    }
  }
  // /employer/profile etc. are declared in the children list; the index route is the section root itself.
  return out;
}

/** The admin site's routes plus one entry per console tab (?tab=). */
export function enumerateAdminRoutes(): { routes: RoutePattern[]; tabs: string[] } {
  const source = readFileSync(repoFile('src/app/routes.tsx'), 'utf8');
  const body = source.slice(source.indexOf('function adminRoutes'));
  const routes: RoutePattern[] = [];
  for (const m of body.matchAll(/path:\s*'([^']+)'/g)) {
    if (m[1] !== '*') routes.push({ pattern: m[1], audience: 'admin' });
  }
  const shared = readFileSync(repoFile('src/app/pages/admin/shared.tsx'), 'utf8');
  const list = /export const ADMIN_TABS = \[([\s\S]*?)\] as const/.exec(shared)?.[1] ?? '';
  const tabs = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { routes, tabs };
}

export interface ConcreteTarget {
  pattern: string;
  /** Path (and query) to open. */
  url: string;
  audience: Audience;
  /** Short human label used in the file name for param routes. */
  label?: string;
  /** One of the screens that also gets a 360x740 capture. */
  key?: boolean;
  /** Extra states reachable by URL only (e.g. an opened thread). */
  variant?: string;
}

// The screens that also get a 360x740 capture: landing, both join flows, directory, profile,
// opportunity, both dashboards, post opportunity, find work, messages, bookings, stage, pricing, urgent.
const KEY_PATTERNS = new Set([
  '/',
  '/join/:audience',
  '/music-professionals',
  '/professionals/:id',
  '/opportunities/:id',
  '/jobseeker',
  '/employer',
  '/employer/post-job',
  '/jobseeker/jobs',
  '/jobseeker/messages',
  '/employer/messages',
  '/jobseeker/bookings',
  '/employer/bookings',
  '/stage',
  '/pricing',
  '/urgent',
]);

const HIRE_ROLES = ['drummer', 'singer', 'dj'];
const HIRE_CITIES = ['mumbai', 'bengaluru'];
const RATE_CITIES = ['mumbai', 'pune'];

/** Fills :params of one pattern with real seeded ids; returns every concrete page to capture. */
export function expand(route: RoutePattern, ids: Ids): ConcreteTarget[] {
  const key = KEY_PATTERNS.has(route.pattern);
  const one = (url: string, label?: string, extra: Partial<ConcreteTarget> = {}): ConcreteTarget => ({
    pattern: route.pattern,
    url,
    audience: route.audience,
    label,
    key,
    ...extra,
  });
  switch (route.pattern) {
    case '/opportunities/:id':
      return [one(`/opportunities/${ids.jobId}`, 'live'), one(`/opportunities/${ids.otherJobId}`, 'other')];
    case '/professionals/:id':
      return [
        one(`/professionals/${ids.demoMusicianId}`, 'demo'),
        one(`/professionals/${ids.musicianId}`, 'populated'),
      ];
    case '/acts/:id':
      return [one(`/acts/${ids.actId}`)];
    case '/hire/:role/:city':
      return HIRE_ROLES.flatMap((role) => HIRE_CITIES.map((city) => one(`/hire/${role}/${city}`, `${role}-${city}`)));
    case '/rates/:city':
      return RATE_CITIES.map((city) => one(`/rates/${city}`, city));
    case '/auth/:userType':
      return [
        one('/auth/jobseeker', 'musician'),
        one('/auth/employer', 'hirer'),
        one('/auth/admin', 'admin'),
        one('/auth/jobseeker?mode=register', 'musician-register', { variant: 'register' }),
        one('/auth/employer?mode=register', 'hirer-register', { variant: 'register' }),
      ];
    case '/pricing':
      return [one('/pricing'), one('/pricing?interval=annual', 'annual', { variant: 'annual' })];
    case '/search':
      return [one('/search'), one('/search?q=tabla%20player', 'results', { variant: 'results' })];
    case '/jobseeker/book-talent':
    case '/employer/book-talent':
      return [
        one(route.pattern),
        one(`${route.pattern}?member=${ids.demoMusicianId}`, 'member-quote', { variant: 'member' }),
        one(`${route.pattern}?act=${ids.actId}`, 'act-enquiry', { variant: 'act' }),
      ];
    case '/employer/applications':
      return [one(route.pattern), one(`${route.pattern}?jobId=${ids.jobId}`, 'live-job', { variant: 'job' })];
    case '/employer/compare':
    case '/jobseeker/compare':
      return [
        one(route.pattern),
        one(`${route.pattern}?ids=${ids.demoMusicianId},${ids.musicianId}`, 'two', { variant: 'ids' }),
      ];
    case '/jobseeker/profile':
      return [one(route.pattern), one(`${route.pattern}?verify=1`, 'verify', { variant: 'verify' })];
    case '/jobseeker/billing':
    case '/employer/billing':
      return [one(route.pattern), one(`${route.pattern}?interval=annual`, 'annual', { variant: 'annual' })];
    case '/join/:audience':
      return [one('/join/musician', 'musician'), one('/join/hiring', 'hiring')];
    case '/urgent/:id':
      return [one(`/urgent/${ids.urgentId}`, 'action')];
    case '/p/:slug':
      return [one(`/p/${ids.portfolioSlug}`)];
    case '/pages/:type/:id':
      return [one(`/pages/${ids.pagesType}/${ids.pagesId}`)];
    case '/stage/tags/:tag':
      return [one(`/stage/tags/${ids.tag}`)];
    case '/stage/authors/:type/:id':
      return [one(`/stage/authors/${ids.postAuthorType}/${ids.postAuthorId}`)];
    case '/stage/posts/:id':
      return [one(`/stage/posts/${ids.postId}`)];
    case '/jobseeker/jobs/:id':
      return [one(`/jobseeker/jobs/${ids.otherJobId}`)];
    case '/employer/jobs/:id':
      return [one(`/employer/jobs/${ids.jobId}`)];
    case '/jobseeker/invoices/:id/print':
    case '/employer/invoices/:id/print':
      return [one(route.pattern.replace(':id', ids.invoiceId))];
    case '/jobseeker/portfolios/:id':
    case '/employer/portfolios/:id':
      return [one(route.pattern.replace(':id', ids.portfolioId))];
    case '/jobseeker/resumes/:id':
    case '/employer/resumes/:id':
    case '/jobseeker/resumes/:id/print':
    case '/employer/resumes/:id/print':
      return [one(route.pattern.replace(':id', 'resume-none'))];
    case '/jobseeker/messages':
    case '/employer/messages':
      return [one(route.pattern), one(`${route.pattern}?c=${ids.conversationId}`, 'thread', { variant: 'thread' })];
    default:
      if (route.pattern.includes(':'))
        throw new Error(`UX sweep: route ${route.pattern} has params with no seeded value; add it to expand().`);
      return [one(route.pattern)];
  }
}

/** Pages that exist only to be reached with a token from an email; opened here without one. */
export const TOKEN_PAGES = ['/verify-email', '/reset-password', '/unsubscribe', '/urgent/:id'];

/** Server-side not-found probes for param routes, to photograph the "missing" state. */
export const MISSING_ID_URLS = [
  '/opportunities/does-not-exist',
  '/professionals/does-not-exist',
  '/acts/does-not-exist',
  '/p/does-not-exist',
  '/this-page-does-not-exist',
];

/** The role names used in folders and the index. */
export const ROLES = ['visitor', 'new-musician', 'musician', 'new-hirer', 'hirer', 'admin'] as const;
export type RoleName = (typeof ROLES)[number];

export const roleKind = (role: RoleName): 'visitor' | 'jobseeker' | 'employer' | 'admin' =>
  role === 'visitor' ? 'visitor' : role.endsWith('musician') ? 'jobseeker' : role === 'admin' ? 'admin' : 'employer';

/** Can this role open a route of this audience without being redirected? */
export function canReach(role: RoleName, audience: Audience): boolean {
  const kind = roleKind(role);
  if (kind === 'admin') return audience === 'admin';
  if (audience === 'public') return true;
  if (audience === 'shared') return kind === 'jobseeker' || kind === 'employer';
  return audience === kind;
}
