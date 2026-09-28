import { Check } from 'lucide-react';
import { cn } from '../ui/utils';

/** A group of toggle chips (several can be on). Each chip is a button with aria-pressed. */
export function ChoiceChips({
  legend,
  hint,
  options,
  selected,
  onChange,
  error,
  id,
}: {
  legend: string;
  hint?: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  error?: string;
  id: string;
}) {
  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((value) => value !== option) : [...selected, option]);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset id={id} aria-describedby={describedBy} tabIndex={-1} className="outline-none">
      <legend className="text-sm font-medium text-slate-200">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option)}
              className={cn(
                'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300',
                on
                  ? 'border-violet-300/70 bg-violet-500/25 text-white'
                  : 'border-white/15 bg-white/[.04] text-slate-200 hover:border-white/30 hover:bg-white/[.08]',
              )}
            >
              {on && <Check aria-hidden="true" size={15} />}
              {option}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}
