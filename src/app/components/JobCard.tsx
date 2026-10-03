import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePrefetchIntent } from '../lib/useCachedGet';
import { ShieldCheck } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { DemoBadge } from './DemoBadge';
import { FormatGlyph } from './kit/FormatGlyph';
import { CoverArt } from './media/CoverArt';
import { formatDeadline, formatPay } from '../lib/format';
import type { Job } from '../lib/apiTypes';
import { optionLabel } from './ui/option-labels';
import { PostedBy } from './showcase/PostedBy';

/** "gig" → "Gig", "on-site work" → "On-site Work". */
export const titleCase = (value: string) => value.replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

type Props = {
  job: Job;
  /** Where the card opens: the public or the signed-in detail page. */
  to: string;
  /** Position in the list (data-job-item), used to move focus after "Load more". */
  index: number;
  /** Controls beside the card body (e.g. the save button). */
  aside?: ReactNode;
  /** Dashboard grid: title, company and pay only. */
  compact?: boolean;
};

/**
 * One opportunity in a list, as a row: generated cover art with the format glyph, title, company · city ·
 * workplace, pay as the most prominent secondary fact, then genre / one skill and the closing date and applicant count.
 * Public and signed-in lists show the same facts (SRCH-13).
 */
export function JobCard({ job, to, index, aside, compact = false }: Props) {
  // Hover, focus or a first touch warms the cache for the public opportunity page (dataCache.ts).
  const prefetchJob = usePrefetchIntent(
    to.startsWith('/opportunities/') ? `/jobs/${encodeURIComponent(job.id)}` : null,
  );
  const applicants = job.applicationsCount || 0;
  const pay = formatPay(job, 'Pay not disclosed');
  const undisclosed = pay === 'Pay not disclosed';
  const payClass = undisclosed ? 'text-sm text-slate-500' : 'text-sm font-semibold text-emerald-200';
  const place = [job.location, job.workplace && optionLabel(job.workplace)].filter(Boolean).join(' · ');
  const chips = compact ? [] : [job.genre, job.function_area || job.skills?.[0]].filter((x): x is string => Boolean(x));
  return (
    <Card
      className="musilynk-lift min-w-0 bg-white/[.055] border-white/10 hover:bg-white/[.075]"
      data-testid="job-card"
    >
      <CardContent className="p-3.5 md:p-4">
        <div className="flex flex-wrap items-start gap-3 md:flex-nowrap">
          <span className="relative shrink-0" data-testid="job-cover">
            <CoverArt
              seed={job.id}
              kind={job.opportunity_kind || 'job'}
              genres={job.genre ? [job.genre] : []}
              size={compact ? 44 : 56}
              rounded
              bars={20}
            />
            <span className="absolute left-1 top-1 grid size-6 place-items-center rounded-full bg-black/40">
              <FormatGlyph kind={job.opportunity_kind || 'job'} size={16} className="text-white!" />
            </span>
          </span>
          <Link
            className={`min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 flex flex-col gap-1 md:gap-4 ${compact ? '' : 'md:flex-row md:justify-between'}`}
            to={to}
            data-job-item={index}
            {...prefetchJob}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-semibold text-base truncate">{job.title}</h2>
                <DemoBadge show={job.demo} className="shrink-0" />
              </div>
              <p className="text-sm text-slate-400 truncate flex items-center gap-1.5" data-testid="job-facts-place">
                <span className="text-violet-300 truncate">{job.company}</span>
                {!compact && job.employerVerified && (
                  <span className="shrink-0 text-emerald-300" title="Verified hirer">
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span className="sr-only">Verified hirer</span>
                  </span>
                )}
                {!compact && place && <span className="truncate">· {place}</span>}
              </p>
              {!compact && <PostedBy postedAs={job.postedAs} link={false} className="mt-0.5 text-xs" />}
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {chips.map((c) => (
                    <Badge
                      variant="outline"
                      key={c}
                      className="border-white/15 px-1.5 py-0 text-xs leading-5 text-slate-300"
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 md:text-right" data-testid="job-facts">
              <p className={payClass}>{pay}</p>
              {!compact && (
                <p className="text-xs text-slate-400 mt-1">
                  <span data-job-deadline>{formatDeadline(job.application_deadline)}</span>
                  {' · '}
                  {applicants} applicant{applicants === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </Link>
          {aside && (
            <div className="flex w-full shrink-0 items-center justify-between gap-3 md:w-auto md:flex-col md:items-end">
              {aside}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
