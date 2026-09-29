import { createBrowserRouter, type RouteObject } from 'react-router';
import { FEATURE_RESUMES, FEATURE_STAGE } from './lib/features';
import React from 'react';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PageLoading } from './components/ExperienceStates';
import { RouteErrorPage } from './components/RouteErrorPage';
import type { Role } from './lib/authContext';
const L = (f: () => Promise<{ default: React.ComponentType }>) => React.lazy(f);
const S = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense fallback={<PageLoading />}>{children}</React.Suspense>
);
const P = ({ roles, children }: { roles: Role[]; children: React.ReactNode }) => (
  <S>
    <ProtectedRoute roles={roles}>{children}</ProtectedRoute>
  </S>
);
// The public marketplace. Its pages are declared inside the function so that the admin build,
// which never calls it, emits none of their chunks.
function publicRoutes(): RouteObject[] {
  const LandingPage = L(() => import('./pages/LandingPage'));
  const AuthPage = L(() => import('./pages/AuthPage'));
  const Join = L(() => import('./pages/Join'));
  const JobSeekerDashboard = L(() => import('./pages/JobSeekerDashboard'));
  const EmployerDashboard = L(() => import('./pages/EmployerDashboard'));
  const JobSearch = L(() => import('./pages/JobSearch'));
  const SavedJobs = L(() => import('./pages/SavedJobs'));
  const JobDetails = L(() => import('./pages/JobDetails'));
  const ProfileSetup = L(() => import('./pages/ProfileSetup'));
  const CompanyProfile = L(() => import('./pages/CompanyProfile'));
  const Portfolio = L(() => import('./pages/Portfolio'));
  const ApplicationTracking = L(() => import('./pages/ApplicationTracking'));
  const EmployerApplications = L(() => import('./pages/EmployerApplications'));
  const PostJob = L(() => import('./pages/PostJob'));
  const CandidateSearch = L(() => import('./pages/CandidateSearch'));
  const Messages = L(() => import('./pages/Messages'));
  const CareerResources = L(() => import('./pages/CareerResources'));
  const Reviews = L(() => import('./pages/Reviews'));
  const Pricing = L(() => import('./pages/Pricing'));
  const Notifications = L(() => import('./pages/Notifications'));
  const NotFound = L(() => import('./pages/NotFound'));
  const Guide = L(() => import('./pages/Guide'));
  const JobAlerts = L(() => import('./pages/JobAlerts'));
  const CandidateCompare = L(() => import('./pages/CandidateCompare'));
  const BuildMyCrew = L(() => import('./pages/BuildMyCrew'));
  const IntentHub = L(() => import('./pages/IntentHub'));
  const GlobalSearch = L(() => import('./pages/GlobalSearch'));
  const SiteMapPage = L(() => import('./pages/public/SiteMapPage'));
  const PublicJobs = L(() => import('./pages/public/PublicJobs'));
  const PublicOpportunity = L(() => import('./pages/public/PublicOpportunity'));
  const PublicTalent = L(() => import('./pages/public/PublicTalent'));
  const PublicProfile = L(() => import('./pages/public/PublicProfile'));
  const PublicActs = L(() => import('./pages/public/PublicActs'));
  const PublicAct = L(() => import('./pages/public/PublicAct'));
  const LegalPage = L(() => import('./pages/public/LegalPage'));
  const UrgentRequests = L(() => import('./pages/UrgentRequests'));
  const UrgentHire = L(() => import('./pages/UrgentHire'));
  const UrgentAction = L(() => import('./pages/UrgentAction'));
  const Availability = L(() => import('./pages/Availability'));
  const VerifyEmail = L(() => import('./pages/VerifyEmail'));
  const Unsubscribe = L(() => import('./pages/Unsubscribe'));
  const ForgotPassword = L(() => import('./pages/ForgotPassword'));
  const ResetPassword = L(() => import('./pages/ResetPassword'));
  const Workspace = L(() => import('./pages/Workspace'));
  const ActsManager = L(() => import('./pages/ActsManager'));
  const BookTalent = L(() => import('./pages/BookTalent'));
  const Bookings = L(() => import('./pages/Bookings'));
  const InvoicePrint = L(() => import('./pages/InvoicePrint'));
  const BandBuilder = L(() => import('./pages/BandBuilder'));
  const Billing = L(() => import('./pages/Billing'));
  const AccountData = L(() => import('./pages/AccountData'));
  const AccountSettings = L(() => import('./pages/AccountSettings'));
  // ---- Showcase (one library, many views; one account, many hats) — begin ----
  const Showcase = React.lazy(() => import('./pages/showcase/ShowcasePage'));
  const showcasePaths = {
    library: 'library',
    portfolios: 'portfolios',
    newPortfolio: 'portfolios/new',
    portfolio: 'portfolios/:id',
    career: 'career',
    resumes: 'resumes',
    resume: 'resumes/:id',
    resumePrint: 'resumes/:id/print',
    review: 'review',
  } as const;
  // The work library (portfolio items) is a job-seeker feature; everything else serves both roles.
  const showcase = (role: Role): RouteObject[] =>
    Object.entries(showcasePaths)
      .filter(([page]) => role === 'jobseeker' || page !== 'library')
      .filter(([page]) => FEATURE_RESUMES || !['career', 'resumes', 'resume', 'resumePrint'].includes(page))
      .map(([page, path]) => ({
        path,
        element: (
          <P roles={[role]}>
            <Showcase page={page as keyof typeof showcasePaths} />
          </P>
        ),
      }));
  const showcasePublic: RouteObject[] = [
    ['/p/:slug', 'publicPortfolio'],
    ['/pages/:type/:id', 'pageJobs'],
  ].map(([path, page]) => ({
    path,
    element: (
      <S>
        <Showcase page={page as 'pageJobs'} />
      </S>
    ),
  }));
  // ---- Showcase — end ----
  // The Stage: the community feed. Owned by the fe-stage change; see src/app/pages/stage/.
  const StageFeed = L(() => import('./pages/stage/StageFeed'));
  const StageTag = L(() => import('./pages/stage/StageTag'));
  const StageAuthor = L(() => import('./pages/stage/StageAuthor'));
  const StagePost = L(() => import('./pages/stage/StagePost'));
  return [
    ...showcasePublic,
    {
      path: '/',
      element: (
        <S>
          <LandingPage />
        </S>
      ),
    },
    {
      path: '/pricing',
      element: (
        <S>
          <Pricing />
        </S>
      ),
    },
    {
      path: '/start',
      element: (
        <S>
          <IntentHub />
        </S>
      ),
    },
    {
      path: '/guide',
      element: (
        <S>
          <Guide />
        </S>
      ),
    },
    {
      path: '/search',
      element: (
        <S>
          <GlobalSearch />
        </S>
      ),
    },
    {
      path: '/sitemap',
      element: (
        <S>
          <SiteMapPage />
        </S>
      ),
    },
    {
      path: '/music-jobs',
      element: (
        <S>
          <PublicJobs />
        </S>
      ),
    },
    {
      path: '/opportunities/:id',
      element: (
        <S>
          <PublicOpportunity />
        </S>
      ),
    },
    {
      path: '/music-professionals',
      element: (
        <S>
          <PublicTalent />
        </S>
      ),
    },
    {
      path: '/professionals/:id',
      element: (
        <S>
          <PublicProfile />
        </S>
      ),
    },
    {
      path: '/book-music',
      element: (
        <S>
          <PublicActs />
        </S>
      ),
    },
    {
      path: '/acts/:id',
      element: (
        <S>
          <PublicAct />
        </S>
      ),
    },
    {
      path: '/about',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/terms',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/privacy',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/safety',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/cookies',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/refund-policy',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/community-guidelines',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/accessibility',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/contact',
      element: (
        <S>
          <LegalPage />
        </S>
      ),
    },
    {
      path: '/verify-email',
      element: (
        <S>
          <VerifyEmail />
        </S>
      ),
    },
    {
      path: '/unsubscribe',
      element: (
        <S>
          <Unsubscribe />
        </S>
      ),
    },
    {
      path: '/forgot-password',
      element: (
        <S>
          <ForgotPassword />
        </S>
      ),
    },
    {
      path: '/reset-password',
      element: (
        <S>
          <ResetPassword />
        </S>
      ),
    },
    {
      path: '/auth/:userType',
      element: (
        <S>
          <AuthPage />
        </S>
      ),
    },
    {
      // Public entry for "need someone by tomorrow": no sign-in required to fill the form,
      // only to publish it (see UrgentHire.tsx).
      path: '/urgent',
      element: (
        <S>
          <UrgentHire />
        </S>
      ),
    },
    {
      // The one-click "mark filled"/"close" link from the expiry-warning email.
      path: '/urgent/:id',
      element: (
        <S>
          <UrgentAction />
        </S>
      ),
    },
    {
      path: '/join/:audience',
      element: (
        <S>
          <Join />
        </S>
      ),
    },
    {
      path: '/jobseeker',
      children: [
        {
          index: true,
          element: (
            <P roles={['jobseeker']}>
              <JobSeekerDashboard />
            </P>
          ),
        },
        {
          path: 'profile',
          element: (
            <P roles={['jobseeker']}>
              <ProfileSetup />
            </P>
          ),
        },
        {
          path: 'portfolio',
          element: (
            <P roles={['jobseeker']}>
              <Portfolio />
            </P>
          ),
        },
        {
          path: 'applications',
          element: (
            <P roles={['jobseeker']}>
              <ApplicationTracking />
            </P>
          ),
        },
        {
          path: 'jobs',
          element: (
            <P roles={['jobseeker']}>
              <JobSearch />
            </P>
          ),
        },
        {
          path: 'saved',
          element: (
            <P roles={['jobseeker']}>
              <SavedJobs />
            </P>
          ),
        },
        {
          path: 'alerts',
          element: (
            <P roles={['jobseeker']}>
              <JobAlerts />
            </P>
          ),
        },
        {
          path: 'jobs/:id',
          element: (
            <P roles={['jobseeker']}>
              <JobDetails />
            </P>
          ),
        },
        {
          path: 'messages',
          element: (
            <P roles={['jobseeker']}>
              <Messages />
            </P>
          ),
        },
        {
          path: 'notifications',
          element: (
            <P roles={['jobseeker']}>
              <Notifications />
            </P>
          ),
        },
        {
          path: 'resources',
          element: (
            <P roles={['jobseeker']}>
              <CareerResources />
            </P>
          ),
        },
        {
          path: 'reviews',
          element: (
            <P roles={['jobseeker']}>
              <Reviews />
            </P>
          ),
        },
        {
          path: 'acts',
          element: (
            <P roles={['jobseeker']}>
              <ActsManager />
            </P>
          ),
        },
        {
          path: 'book-talent',
          element: (
            <P roles={['jobseeker']}>
              <BookTalent />
            </P>
          ),
        },
        {
          path: 'bookings',
          element: (
            <P roles={['jobseeker']}>
              <Bookings />
            </P>
          ),
        },
        {
          path: 'invoices/:id/print',
          element: (
            <P roles={['jobseeker']}>
              <InvoicePrint />
            </P>
          ),
        },
        {
          path: 'band-builder',
          element: (
            <P roles={['jobseeker']}>
              <BandBuilder />
            </P>
          ),
        },
        {
          path: 'urgent',
          element: (
            <P roles={['jobseeker']}>
              <UrgentRequests />
            </P>
          ),
        },
        {
          path: 'availability',
          element: (
            <P roles={['jobseeker']}>
              <Availability />
            </P>
          ),
        },
        {
          path: 'hiring/post',
          element: (
            <P roles={['jobseeker']}>
              <PostJob />
            </P>
          ),
        },
        {
          path: 'hiring/talent',
          element: (
            <P roles={['jobseeker']}>
              <CandidateSearch />
            </P>
          ),
        },
        {
          path: 'compare',
          element: (
            <P roles={['jobseeker']}>
              <CandidateCompare />
            </P>
          ),
        },
        {
          path: 'build-my-crew',
          element: (
            <P roles={['jobseeker']}>
              <BuildMyCrew />
            </P>
          ),
        },
        {
          path: 'hiring/applicants',
          element: (
            <P roles={['jobseeker']}>
              <EmployerApplications />
            </P>
          ),
        },
        {
          path: 'billing',
          element: (
            <P roles={['jobseeker']}>
              <Billing />
            </P>
          ),
        },
        {
          path: 'account',
          element: (
            <P roles={['jobseeker']}>
              <AccountData />
            </P>
          ),
        },
        {
          path: 'settings',
          element: (
            <P roles={['jobseeker']}>
              <AccountSettings />
            </P>
          ),
        },
        {
          path: 'workspace',
          element: (
            <P roles={['jobseeker']}>
              <Workspace />
            </P>
          ),
        },
        ...showcase('jobseeker'), // Showcase
      ],
    },
    {
      path: '/employer',
      children: [
        {
          index: true,
          element: (
            <P roles={['employer']}>
              <EmployerDashboard />
            </P>
          ),
        },
        {
          path: 'profile',
          element: (
            <P roles={['employer']}>
              <CompanyProfile />
            </P>
          ),
        },
        {
          path: 'post-job',
          element: (
            <P roles={['employer']}>
              <PostJob />
            </P>
          ),
        },
        {
          path: 'candidates',
          element: (
            <P roles={['employer']}>
              <CandidateSearch />
            </P>
          ),
        },
        {
          path: 'compare',
          element: (
            <P roles={['employer']}>
              <CandidateCompare />
            </P>
          ),
        },
        {
          path: 'build-my-crew',
          element: (
            <P roles={['employer']}>
              <BuildMyCrew />
            </P>
          ),
        },
        {
          path: 'applications',
          element: (
            <P roles={['employer']}>
              <EmployerApplications />
            </P>
          ),
        },
        {
          path: 'jobs/:id',
          element: (
            <P roles={['employer']}>
              <JobDetails />
            </P>
          ),
        },
        {
          path: 'messages',
          element: (
            <P roles={['employer']}>
              <Messages />
            </P>
          ),
        },
        {
          path: 'notifications',
          element: (
            <P roles={['employer']}>
              <Notifications />
            </P>
          ),
        },
        {
          path: 'acts',
          element: (
            <P roles={['employer']}>
              <ActsManager />
            </P>
          ),
        },
        {
          path: 'book-talent',
          element: (
            <P roles={['employer']}>
              <BookTalent />
            </P>
          ),
        },
        {
          path: 'bookings',
          element: (
            <P roles={['employer']}>
              <Bookings />
            </P>
          ),
        },
        {
          path: 'invoices/:id/print',
          element: (
            <P roles={['employer']}>
              <InvoicePrint />
            </P>
          ),
        },
        {
          path: 'band-builder',
          element: (
            <P roles={['employer']}>
              <BandBuilder />
            </P>
          ),
        },
        {
          path: 'urgent',
          element: (
            <P roles={['employer']}>
              <UrgentRequests />
            </P>
          ),
        },
        {
          path: 'availability',
          element: (
            <P roles={['employer']}>
              <Availability />
            </P>
          ),
        },
        {
          path: 'billing',
          element: (
            <P roles={['employer']}>
              <Billing />
            </P>
          ),
        },
        {
          path: 'account',
          element: (
            <P roles={['employer']}>
              <AccountData />
            </P>
          ),
        },
        {
          path: 'settings',
          element: (
            <P roles={['employer']}>
              <AccountSettings />
            </P>
          ),
        },
        {
          path: 'workspace',
          element: (
            <P roles={['employer']}>
              <Workspace />
            </P>
          ),
        },
        ...showcase('employer'), // Showcase
      ],
    },
    // === The Stage (community feed) — begin ===
    // Top-level, not role-prefixed: both jobseeker and employer accounts use the same identity
    // (person or a Page they run) on the Stage. Author and tag pages are public-data reads but
    // still sit behind sign-in here, matching the rest of the authenticated app; the composer
    // and reactions always require it.
    ...(FEATURE_STAGE
      ? [
          {
            path: '/stage',
            element: (
              <P roles={['jobseeker', 'employer']}>
                <StageFeed />
              </P>
            ),
          },
          {
            path: '/stage/tags/:tag',
            element: (
              <P roles={['jobseeker', 'employer']}>
                <StageTag />
              </P>
            ),
          },
          {
            path: '/stage/authors/:type/:id',
            element: (
              <P roles={['jobseeker', 'employer']}>
                <StageAuthor />
              </P>
            ),
          },
          {
            path: '/stage/posts/:id',
            element: (
              <P roles={['jobseeker', 'employer']}>
                <StagePost />
              </P>
            ),
          },
        ]
      : []),
    // === The Stage (community feed) — end ===
    // Admin pages live on the separate admin site; the old sign-in link here is gone too.
    {
      path: '/auth/admin',
      element: (
        <S>
          <NotFound />
        </S>
      ),
    },
    {
      path: '*',
      element: (
        <S>
          <NotFound />
        </S>
      ),
    },
  ];
}

// The separate admin site (VITE_APP_TARGET=admin): sign-in at the root, then the console, the
// live tester and the admin's own account behind one admin-only layout. Nothing public.
function adminRoutes(): RouteObject[] {
  const AdminSignIn = L(() => import('./pages/admin-site/AdminSignIn'));
  const AdminSiteLayout = L(() => import('./pages/admin-site/AdminSiteLayout'));
  const AdminDashboard = L(() => import('./pages/AdminDashboard'));
  const AdminTester = L(() => import('./pages/AdminTester'));
  const AdminAccount = L(() => import('./pages/admin-site/AdminAccount'));
  const NotFound = L(() => import('./pages/NotFound'));
  return [
    {
      path: '/',
      element: (
        <S>
          <AdminSignIn />
        </S>
      ),
    },
    {
      element: (
        <P roles={['admin']}>
          <AdminSiteLayout />
        </P>
      ),
      children: [
        {
          path: '/admin',
          element: (
            <S>
              <AdminDashboard />
            </S>
          ),
        },
        {
          path: '/admin/tester',
          element: (
            <S>
              <AdminTester />
            </S>
          ),
        },
        {
          path: '/account',
          element: (
            <S>
              <AdminAccount />
            </S>
          ),
        },
      ],
    },
    {
      path: '*',
      element: (
        <S>
          <NotFound />
        </S>
      ),
    },
  ];
}

// The pathless root route gives every page one error boundary: stale lazy chunks after a
// redeploy reload once, other render errors show a branded recovery screen. Vite replaces
// import.meta.env.VITE_APP_TARGET with a literal, so only one route table is bundled.
export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: import.meta.env.VITE_APP_TARGET === 'admin' ? adminRoutes() : publicRoutes(),
  },
]);
