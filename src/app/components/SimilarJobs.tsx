import { useEffect, useRef, useState } from 'react';
import { JobCard } from './JobCard';
import { apiGet } from '../lib/api';
import type { Job } from '../lib/apiTypes';

/** Same kind first, then the same city, then the same genre; the opportunity being read is never in the list. */
export function pickSimilar(
  job: Pick<Job, 'id' | 'location' | 'genre' | 'opportunity_kind'>,
  candidates: Job[],
  max = 3,
) {
  const city = (job.location || '').split(',')[0].trim().toLowerCase();
  const score = (other: Job) =>
    (other.opportunity_kind && other.opportunity_kind === job.opportunity_kind ? 4 : 0) +
    (city && (other.location || '').toLowerCase().includes(city) ? 2 : 0) +
    (job.genre && other.genre === job.genre ? 1 : 0);
  return candidates
    .filter((other) => String(other.id) !== String(job.id))
    .map((other, order) => ({ other, order, points: score(other) }))
    .sort((a, b) => b.points - a.points || a.order - b.order)
    .slice(0, max)
    .map(({ other }) => other);
}

/**
 * Up to three other open opportunities under a job page. `basePath` is where a card opens
 * ("/opportunities" on the public site, "/jobseeker/jobs" in the workspace). Renders nothing while
 * loading, on failure, or when there is no other opportunity.
 */
export function SimilarJobs({ job, basePath }: { job: Job; basePath: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let observer: IntersectionObserver | undefined;
    // No kind filter: pickSimilar ranks same kind first and falls back to city and genre.
    const fetchSimilar = () =>
      apiGet<{ jobs?: Job[] }>('/jobs?limit=24')
        .then((d) => live && setJobs(pickSimilar(job, d.jobs || [])))
        .catch(() => live && setJobs([]));
    // The list is below the fold: wait until it is about to scroll into view so the 24-job fetch
    // and the card render do not compete with the first paint of the opportunity itself.
    if (anchor.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          void fetchSimilar();
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(anchor.current);
    } else {
      void fetchSimilar();
    }
    return () => {
      live = false;
      observer?.disconnect();
    };
    // The list depends on which opportunity is open, not on every field of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);
  if (!jobs.length) return <div ref={anchor} aria-hidden="true" />;
  return (
    <section aria-labelledby="similar-jobs" data-testid="similar-jobs">
      <h2 id="similar-jobs" className="text-xl font-semibold">
        Similar opportunities
      </h2>
      <div className="mt-4 space-y-3">
        {jobs.map((other, index) => (
          <JobCard
            key={other.id}
            job={other}
            index={index}
            to={`${basePath}/${encodeURIComponent(String(other.id))}`}
          />
        ))}
      </div>
    </section>
  );
}
