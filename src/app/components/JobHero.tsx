import type { ReactNode } from 'react';
import { CalendarDays, Clock, MapPin, ShieldCheck, Wallet } from 'lucide-react';
import { DemoBadge } from './DemoBadge';
import { CoverArt } from './media/CoverArt';
import { optionLabel } from './ui/option-labels';
import { PostedBy } from './showcase/PostedBy';
import { formatDate, formatDeadline, formatPay } from '../lib/format';
import type { Job } from '../lib/apiTypes';

/** Shared job-details hero: cover art, format glyph, title, company and a 2x2 fact grid (Pay, Date, Place, Closes). */
export function JobHero({ job, actions }: { job: Job; actions?: ReactNode }) {
  const place = [job.location, job.workplace && optionLabel(job.workplace)].filter(Boolean).join(' · ');
  const facts = [
    { Icon: Wallet, label: 'Pay', value: formatPay(job) },
    {
      Icon: CalendarDays,
      label: 'Date',
      value: job.start_date ? `Starts ${formatDate(job.start_date)}` : 'To be agreed',
    },
    { Icon: MapPin, label: 'Where', value: place || 'Not specified' },
    { Icon: Clock, label: 'Closes', value: formatDeadline(job.application_deadline, { verb: 'Apply by' }) },
  ];
  return (
    <header data-testid="job-hero">
      <div className="mb-5 h-28 overflow-hidden rounded-xl sm:h-36" data-testid="job-hero-art">
        <CoverArt
          seed={job.id}
          kind={job.opportunity_kind || 'job'}
          genres={job.genre ? [job.genre] : []}
          size="fill"
          className="block size-full"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <span className="font-medium">{optionLabel(job.opportunity_kind || 'job')}</span>
          <DemoBadge show={job.demo} />
          {job.employerVerified && (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <ShieldCheck size={14} aria-hidden="true" />
              Verified employer
            </span>
          )}
        </div>
        {actions}
      </div>
      <h1 className="mt-3 text-3xl font-bold leading-tight break-words">{job.title}</h1>
      <p className="mt-1 text-lg text-violet-300">{job.company}</p>
      <PostedBy postedAs={job.postedAs} className="mt-1" />
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {facts.map(({ Icon, label, value }) => (
          <li key={label} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <Icon aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <span className="block text-xs text-slate-400">{label}</span>
              <span className="block text-sm font-medium text-slate-100 [overflow-wrap:anywhere]">{value}</span>
            </div>
          </li>
        ))}
      </ul>
    </header>
  );
}
