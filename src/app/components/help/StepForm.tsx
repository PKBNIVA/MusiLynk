import { useRef, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '../ui/utils';

export interface FormStep {
  id: string;
  title: string;
  icon: LucideIcon;
  /** One line under the step heading. */
  description?: string;
  content: ReactNode;
}

/**
 * A multi-step form body: a progress indicator, then every step's fields. All steps stay mounted
 * (inactive ones are `hidden`) so values, ids and error focus keep working; the parent owns the
 * current step and the Back / Next / submit buttons, and validates only the step being left.
 */
export function StepForm({
  steps,
  current,
  reached = current,
  onStepChange,
}: {
  steps: FormStep[];
  current: number;
  /** The furthest step reached so far; any step up to it can be revisited from the indicator. */
  reached?: number;
  /** Called when a reachable step is chosen in the progress indicator. */
  onStepChange: (index: number) => void;
}) {
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const pct = Math.round(((current + 1) / steps.length) * 100);
  return (
    <div>
      <nav aria-label="Form progress" className="mb-6">
        <p className="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>
            Step {current + 1} of {steps.length}
          </span>
          <span aria-hidden="true">{pct}%</span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-teal-400 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            const open = !active && i <= reached;
            const Icon = done ? Check : s.icon;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!open}
                  onClick={() => onStepChange(i)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex w-full min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    active && 'border-violet-400/50 bg-violet-500/15 text-white',
                    open && 'border-white/10 bg-white/[.03] text-slate-200 hover:border-violet-400/40',
                    !active && !open && 'border-white/10 text-slate-400 disabled:cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-lg',
                      active ? 'bg-violet-500 text-white' : done ? 'bg-teal-500/20 text-teal-200' : 'bg-white/5',
                    )}
                  >
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="sr-only">
                      {done ? 'Completed: ' : active ? 'Current: ' : open ? 'Go to: ' : 'Upcoming: '}
                    </span>
                    {s.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {steps.map((s, i) => (
        <section key={s.id} hidden={i !== current} aria-labelledby={`step-${s.id}-title`} data-step={s.id}>
          <div className="mb-5">
            <h2
              id={`step-${s.id}-title`}
              ref={(el) => {
                headings.current[i] = el;
              }}
              tabIndex={-1}
              className="flex scroll-mt-28 items-center gap-2 text-2xl font-semibold outline-none"
            >
              <s.icon aria-hidden="true" size={24} className="text-violet-300" />
              {s.title}
            </h2>
            {s.description && <p className="mt-1 text-sm text-slate-400">{s.description}</p>}
          </div>
          {s.content}
        </section>
      ))}
    </div>
  );
}

/** Moves focus to a step's heading after the step changes (call after the state update renders). */
export function focusStepHeading(stepId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`step-${stepId}-title`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  });
}

/** A read-only summary row for the review step, with a link back to the step that owns it. */
export function ReviewRow({ label, value, onEdit }: { label: string; value: ReactNode; onEdit?: () => void }) {
  return (
    <div className="border-b border-white/10 py-2.5 last:border-0 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="flex min-w-0 items-start justify-between gap-4">
        <span className="min-w-0 flex-1 text-sm text-slate-100 [overflow-wrap:anywhere]">
          {value || <span className="text-slate-500">Not set</span>}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-md px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Edit<span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        )}
      </dd>
    </div>
  );
}
