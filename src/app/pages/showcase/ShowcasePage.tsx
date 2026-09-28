import { lazy, Suspense } from 'react';
import { PageLoading } from '../../components/ExperienceStates';

// One small chunk that the route table loads for every showcase path; each page is its own lazy
// chunk behind it, so the entry bundle carries a single import instead of one per page.
const PAGES = {
  library: lazy(() => import('./Library')),
  portfolios: lazy(() => import('./Portfolios')),
  newPortfolio: lazy(() => import('./NewPortfolio')),
  portfolio: lazy(() => import('./PortfolioEditor')),
  career: lazy(() => import('./CareerRecord')),
  resumes: lazy(() => import('./Resumes')),
  resume: lazy(() => import('./ResumeEditor')),
  resumePrint: lazy(() => import('./ResumePrint')),
  review: lazy(() => import('./ReviewInbox')),
  publicPortfolio: lazy(() => import('../public/PublicPortfolio')),
  pageJobs: lazy(() => import('../public/PageJobs')),
};
export type ShowcasePageName = keyof typeof PAGES;

export default function ShowcasePage({ page }: { page: ShowcasePageName }) {
  const Page = PAGES[page];
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}
