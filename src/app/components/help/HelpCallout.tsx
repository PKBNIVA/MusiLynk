import { useState } from 'react';
import { HelpCircle, X, type LucideIcon } from 'lucide-react';

export interface HelpStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

const KEY = 'verse_help_hidden:';
function readHidden(id: string) {
  try {
    return localStorage.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
}
function writeHidden(id: string, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(KEY + id, '1');
    else localStorage.removeItem(KEY + id);
  } catch {}
}

/**
 * A dismissible "How this works" card with three short icon steps. Once hidden it shrinks to a
 * single "How this works" link, so the help is never more than one click away. The choice is
 * remembered per page in localStorage (and simply resets if storage is blocked).
 */
export function HelpCallout({ id, title, steps }: { id: string; title: string; steps: HelpStep[] }) {
  const [hidden, setHidden] = useState(() => readHidden(id));
  const toggle = (next: boolean) => {
    setHidden(next);
    writeHidden(id, next);
  };
  if (hidden)
    return (
      <div className="mb-6 flex justify-end">
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-expanded="false"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <HelpCircle aria-hidden="true" size={16} />
          How this works
        </button>
      </div>
    );
  return (
    <section
      aria-label={title}
      data-help-callout={id}
      className="verse-help relative mb-8 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[.09] via-fuchsia-500/[.04] to-teal-400/[.05] p-5 md:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold text-white">
          <HelpCircle aria-hidden="true" size={20} className="text-violet-300" />
          {title}
        </p>
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label={`Hide tips: ${title}`}
          aria-expanded="true"
          className="-m-1 grid size-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
              <s.icon aria-hidden="true" size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-slate-400">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
