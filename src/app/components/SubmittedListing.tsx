import { Link } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';

const STEPS = [
  'We review it within 24 hours.',
  'Once approved it goes live and musicians can apply. We email you when that happens.',
  'You can edit it any time from Your opportunities.',
];

/** Shown after an opportunity is submitted: what happens next, instead of dropping the poster on a dashboard (J-12). */
export function SubmittedListing({
  title,
  viewPath,
  dashboardPath,
  onAnother,
}: {
  title: string;
  viewPath: string;
  dashboardPath: string;
  onAnother: () => void;
}) {
  return (
    <section
      aria-labelledby="submitted-title"
      data-testid="submitted-card"
      className="verse-surface rounded-3xl p-6 md:p-8"
    >
      <CheckCircle2 aria-hidden="true" className="size-9 text-emerald-300" />
      <h2 id="submitted-title" className="mt-4 text-2xl font-bold">
        Submitted for review
      </h2>
      <p className="mt-1 break-words text-slate-300">{title || 'Your opportunity'}</p>
      <h3 className="mt-6 text-sm font-semibold uppercase tracking-[.14em] text-slate-400">What happens next</h3>
      <ol className="mt-3 space-y-2 text-slate-200">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-500/20 text-sm font-semibold text-violet-200">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link to={viewPath}>View my opportunity</Link>
        </Button>
        <Button variant="outline" onClick={onAnother}>
          Post another
        </Button>
        <Button variant="ghost" asChild>
          <Link to={dashboardPath}>Back to dashboard</Link>
        </Button>
      </div>
    </section>
  );
}
