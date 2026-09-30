import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { PublicDetailState } from '../../components/PublicDetailState';
import { usePageMeta } from '../../components/PageMeta';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { apiGet } from '../../lib/api';
import { errorMessage, errorStatus } from '../../lib/errors';
import type { Job } from '../../lib/apiTypes';
import { JobHero } from '../../components/JobHero';
import { SimilarJobs } from '../../components/SimilarJobs';
import { useAuth } from '../../lib/authContext';
import { ShareToStageButton } from '../../components/stage/ShareToStageButton';
import { FEATURE_STAGE } from '../../lib/features';

const EMPLOYMENT_TYPES: Record<string, string> = {
  'full-time': 'FULL_TIME',
  'full time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  'part time': 'PART_TIME',
  contract: 'CONTRACTOR',
  contractor: 'CONTRACTOR',
  freelance: 'CONTRACTOR',
  'project-based': 'CONTRACTOR',
  temporary: 'TEMPORARY',
  temp: 'TEMPORARY',
};

/** JobPosting structured data for a public opportunity, built from the same fields as the
 * backend share page (backend/app/controllers/share_pages_controller.rb). */
function jobPostingJsonLd(j: Job) {
  const employmentType = EMPLOYMENT_TYPES[(j.type || j.kind || '').toLowerCase()] || 'OTHER';
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: j.title,
    description: j.description || '',
    datePosted: j.published_at || j.created_at,
    employmentType,
    hiringOrganization: { '@type': 'Organization', name: j.company },
    directApply: true,
    identifier: { '@type': 'PropertyValue', name: 'Verse', value: j.id },
  };
  if (j.application_deadline) ld.validThrough = j.application_deadline;
  if (j.workplace === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
  } else {
    ld.jobLocation = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: j.location, addressCountry: 'IN' },
    };
  }
  if (j.compensation_min != null || j.compensation_max != null) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: j.currency || 'INR',
      value: {
        '@type': 'QuantitativeValue',
        minValue: j.compensation_min,
        maxValue: j.compensation_max,
        unitText: (j.compensation_period || 'MONTH').toUpperCase(),
      },
    };
  }
  return ld;
}

export default function PublicOpportunity() {
  const { id } = useParams();
  const { isAuthenticated, status } = useAuth();
  const [j, setJ] = useState<Job>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<{ job?: Job }>(`/jobs/${encodeURIComponent(id || '')}`);
      setJ(d.job);
    } catch (e: unknown) {
      setJ(undefined);
      setError({ message: errorMessage(e, 'Unable to load this opportunity.'), status: errorStatus(e) });
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  usePageMeta(
    j?.title && `${j.title}${j.company ? ` at ${j.company}` : ''}`,
    j ? `${j.opportunity_kind || 'Opportunity'} in ${j.location || 'India'}. ${j.description || ''}` : undefined,
    { canonicalPath: `/opportunities/${id}`, type: 'article', jsonLd: j ? jobPostingJsonLd(j) : undefined },
  );
  if (loading || error || !j)
    return (
      <PublicDetailState
        loading={loading}
        error={error || (!loading && !j ? { message: 'Not found', status: 404 } : null)}
        noun="opportunity"
        backTo="/music-jobs"
        backLabel="Browse music jobs"
        onRetry={() => void load()}
      />
    );
  const target = `/jobseeker/jobs/${encodeURIComponent(String(j.id ?? id))}`;
  // status stays 'loading' briefly on a full page load while the stored session is verified;
  // holding the button back until then avoids flashing "Sign in to apply" before "Apply" (V-13).
  const applyButton =
    status === 'loading' ? null : status === 'signedIn' ? (
      <Button size="lg" className="w-full" asChild>
        <Link to={target}>Apply</Link>
      </Button>
    ) : (
      <Button size="lg" className="w-full" asChild>
        <Link to="/auth/jobseeker" state={{ from: target }}>
          Sign in to apply
        </Link>
      </Button>
    );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-5xl mx-auto px-5 pb-28 pt-12 lg:pb-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <Card className="bg-white/[.055] border-white/10">
            <CardContent className="p-6 md:p-8">
              <JobHero
                job={j}
                actions={
                  FEATURE_STAGE && isAuthenticated && <ShareToStageButton kind="job_share" id={j.id} label={j.title} />
                }
              />
              <div className="mt-8 pt-7 border-t border-white/10">
                <h2 className="text-xl font-semibold">About the opportunity</h2>
                <p className="whitespace-pre-wrap leading-7 text-slate-300 mt-3">{j.description}</p>
                {j.requirements && (
                  <>
                    <h2 className="text-xl font-semibold mt-8">Requirements</h2>
                    <p className="whitespace-pre-wrap leading-7 text-slate-300 mt-3">{j.requirements}</p>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-7">
                {[j.function_area || j.type, ...(j.skills || [])].filter(Boolean).map((x) => (
                  <Badge key={x} variant="outline">
                    {x}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-white/10 bg-white/[.055] p-5">{applyButton}</div>
          </aside>
        </div>
        <div className="mt-8">
          <SimilarJobs job={j} basePath="/opportunities" />
        </div>
        {applyButton && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/95 p-3 backdrop-blur lg:hidden">
            {applyButton}
          </div>
        )}
        <p className="text-xs text-slate-500 mt-5">
          Never pay private application or audition fees. Verse listings can be reported after sign-in.
        </p>
      </main>
    </div>
  );
}
