import { useState } from 'react';
import { HelpCircle, X, type LucideIcon } from 'lucide-react';

export interface HelpStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

// Collapsed unless the person has explicitly opened it before (default: just the link).
const KEY = 'musilynk_help_shown:';
function readShown(id: string) {
  try {
    return localStorage.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
}
function writeShown(id: string, shown: boolean) {
  try {
    if (shown) localStorage.setItem(KEY + id, '1');
    else localStorage.removeItem(KEY + id);
  } catch {}
}

/**
 * A "How this works" link that expands into a card with three short icon steps. It is collapsed
 * by default and remembered per page in localStorage (and simply resets if storage is blocked).
 * On small screens the card never renders; the link goes to the guide instead.
 */
export function HelpCallout({ id, title, steps }: { id: string; title: string; steps: HelpStep[] }) {
  const [shown, setShown] = useState(() => readShown(id));
  const toggle = (next: boolean) => {
    setShown(next);
    writeShown(id, next);
  };
  const onLink = () => {
    // Small screens never get the card: the link goes to the guide instead.
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)').matches : true;
    if (wide) toggle(!shown);
    else window.location.assign('/guide');
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onLink}
        aria-expanded={shown}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 py-1.5 text-sm text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <HelpCircle aria-hidden="true" size={16} />
        How this works
      </button>
      {shown && (
        <section
          aria-label={title}
          data-help-callout={id}
          className="musilynk-help absolute right-0 top-full z-30 mt-2 hidden w-[min(92vw,52rem)] rounded-2xl border border-violet-400/20 bg-slate-950 p-5 shadow-2xl md:block md:p-6"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-white">
              <HelpCircle aria-hidden="true" size={20} className="text-violet-300" />
              {title}
            </p>
            <button
              type="button"
              onClick={() => toggle(false)}
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
      )}
    </div>
  );
}
