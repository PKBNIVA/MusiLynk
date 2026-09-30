import type { ReactNode } from 'react';

/**
 * The single header used by every signed-in app page: a one-line title, at most one short hint
 * line, and right-aligned actions. Kept deliberately small (under ~72px) so real content is in
 * the first fold. No eyebrow labels, no multi-line subtitles.
 */
export function PageHeader({
  title,
  hint,
  actions,
  help,
  className = '',
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  /** A collapsed "How this works" link, shown first in the actions cluster. */
  help?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight md:text-3xl">{title}</h1>
        {hint && <p className="mt-0.5 text-sm text-slate-400">{hint}</p>}
      </div>
      {(actions || help) && (
        <div className="flex flex-wrap items-center gap-2">
          {help}
          {actions}
        </div>
      )}
    </div>
  );
}
