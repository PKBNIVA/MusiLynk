import { Link } from 'react-router';
import { Building2, Music } from 'lucide-react';
import { pageJobsPath, type PostedAs } from '../../lib/showcase';
import { cn } from '../ui/utils';

/** "Posted by <Page>": a link to the Page's jobs, or plain text inside another link (a job card). */
export function PostedBy({
  postedAs,
  link = true,
  className,
}: {
  postedAs?: PostedAs | null;
  link?: boolean;
  className?: string;
}) {
  if (!postedAs) return null;
  const Icon = postedAs.type === 'act' ? Music : Building2;
  const name = link ? (
    <Link to={pageJobsPath(postedAs)} className="font-medium text-teal-200 underline-offset-2 hover:underline">
      {postedAs.name}
    </Link>
  ) : (
    <span className="font-medium text-teal-200">{postedAs.name}</span>
  );
  return (
    <p className={cn('flex items-center gap-1.5 text-sm text-slate-400', className)} data-testid="posted-by">
      <Icon size={14} aria-hidden="true" />
      <span>Posted by {name}</span>
    </p>
  );
}
