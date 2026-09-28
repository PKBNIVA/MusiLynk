import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Briefcase, CalendarDays, MapPin, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { DemoBadge } from './DemoBadge';
import { formatDeadline, formatPay } from '../lib/format';
import type { Job } from '../lib/apiTypes';

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
};

/**
 * One opportunity in a list. Public and signed-in lists show the same facts in the same order:
 * type, trust badges, title, company, location · workplace, function, genre, pay, applicants and
 * the closing date (SRCH-13).
 */
export function JobCard({ job, to, index, aside }: Props) {
  const applicants = job.applicationsCount || 0;
  return (
    <Card className="bg-white/[.055] border-white/10 hover:bg-white/[.075] transition" data-testid="job-card">
      <CardContent className="p-5 md:p-6">
        <div className="flex gap-4 justify-between">
          <Link
            className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            to={to}
            data-job-item={index}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="secondary">{titleCase(job.opportunity_kind || 'job')}</Badge>
              <DemoBadge show={job.demo} />
              {job.employerVerified && (
                <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-400/20">
                  <ShieldCheck size={13} className="mr-1" />
                  Verified
                </Badge>
              )}
              {job.featured && <Badge>Featured</Badge>}
              {job.fitScore ? (
                <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20">{job.fitScore}% profile fit</Badge>
              ) : null}
            </div>
            <h2 className="text-xl md:text-2xl font-semibold break-words">{job.title}</h2>
            <p className="text-violet-300 mt-1">{job.company}</p>
            <div className="text-sm text-slate-400 mt-3 flex flex-wrap gap-x-4 gap-y-2" data-testid="job-facts">
              <span className="flex items-center">
                <MapPin size={15} className="mr-1" aria-hidden="true" />
                {job.location}
                {job.workplace ? ` · ${titleCase(job.workplace)}` : ''}
              </span>
              {(job.function_area || job.type) && (
                <span className="flex items-center">
                  <Briefcase size={15} className="mr-1" aria-hidden="true" />
                  {job.function_area || job.type}
                </span>
              )}
              {job.genre && <span>{job.genre}</span>}
              <span className="flex items-center">
                <Wallet size={15} className="mr-1" aria-hidden="true" />
                {formatPay(job, 'Pay not disclosed')}
              </span>
              <span className="flex items-center">
                <Users size={15} className="mr-1" aria-hidden="true" />
                {applicants} applicant{applicants === 1 ? '' : 's'}
              </span>
              <span className="flex items-center" data-job-deadline>
                <CalendarDays size={15} className="mr-1" aria-hidden="true" />
                {formatDeadline(job.application_deadline)}
              </span>
            </div>
            {job.skills?.length ? (
              <div className="flex flex-wrap gap-2 mt-4">
                {job.skills.slice(0, 6).map((skill) => (
                  <Badge variant="outline" key={skill} className="border-white/15 text-slate-300">
                    {skill}
                  </Badge>
                ))}
              </div>
            ) : null}
          </Link>
          {aside && <div className="flex flex-col items-end gap-3 shrink-0">{aside}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
