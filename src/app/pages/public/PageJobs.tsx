import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Briefcase, Building2, Music } from 'lucide-react';
import { PublicNav } from '../../components/PublicNav';
import { PublicDetailState } from '../../components/PublicDetailState';
import { usePageMeta } from '../../components/PageMeta';
import { JobCard } from '../../components/JobCard';
import { EmptyState } from '../../components/kit/EmptyState';
import { apiGet } from '../../lib/api';
import { errorMessage, errorStatus } from '../../lib/errors';
import type { Job } from '../../lib/apiTypes';
import type { PostedAs } from '../../lib/showcase';

/** Every published opportunity a Page (studio or band) posted, newest first. */
export default function PageJobs() {
  const { type = '', id = '' } = useParams();
  const [data, setData] = useState<{ page: PostedAs; jobs: Job[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (type !== 'organization' && type !== 'act') throw Object.assign(new Error('Not found'), { status: 404 });
      setData(await apiGet<{ page: PostedAs; jobs: Job[] }>(`/pages/${type}/${encodeURIComponent(id)}/jobs`));
    } catch (e: unknown) {
      setError({ message: errorMessage(e, 'Unable to load this page.'), status: errorStatus(e) ?? 404 });
    } finally {
      setLoading(false);
    }
  }, [type, id]);
  useEffect(() => {
    void load();
  }, [load]);
  const page = data?.page;
  usePageMeta(
    page ? `Opportunities at ${page.name}` : undefined,
    page ? `Open music jobs and gigs posted by ${page.name} on Verse.` : undefined,
  );
  if (loading || error || !data || !page)
    return (
      <PublicDetailState
        loading={loading}
        error={error || (!loading ? { message: 'Not found', status: 404 } : null)}
        noun="page"
        backTo="/music-jobs"
        backLabel="Browse music jobs"
        onRetry={() => void load()}
      />
    );
  const Icon = page.type === 'act' ? Music : Building2;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 md:px-6">
        <header className="mb-8 flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-teal-500">
            <Icon size={26} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold break-words md:text-4xl">{page.name}</h1>
            <p className="text-slate-400">
              {data.jobs.length} open opportunit{data.jobs.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </header>
        {data.jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title={`${page.name} has no open opportunities right now`}>
            Check back soon, or browse every music job on Verse.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {data.jobs.map((job, index) => (
              <JobCard key={job.id} job={job} index={index} to={`/opportunities/${job.id}`} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
