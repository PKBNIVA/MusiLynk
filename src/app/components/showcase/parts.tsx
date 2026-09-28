import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Ban, Pin, RotateCcw, X, type LucideIcon } from 'lucide-react';
import { Navigation } from '../Navigation';
import { HelpCallout, type HelpStep } from '../help/HelpCallout';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { cn } from '../ui/utils';
import { useAuth } from '../../lib/authContext';
import type { ItemState } from '../../lib/showcase';

/** "/jobseeker" or "/employer": where this person's workspace pages live. */
export function useWorkspaceBase() {
  const { user } = useAuth();
  return user?.role === 'employer' ? '/employer' : '/jobseeker';
}

/** The frame of every library, portfolio, resume and review page. */
export function ShowcaseShell({
  title,
  description,
  help,
  actions,
  back,
  children,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  help?: { id: string; title: string; steps: HelpStep[] };
  actions?: ReactNode;
  back?: { to: string; label: string };
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className={cn('mx-auto px-4 pb-28 pt-28 md:px-6 lg:pb-16', wide ? 'max-w-7xl' : 'max-w-5xl')}>
        {back && (
          <Link
            to={back.to}
            className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <h1 className="text-3xl font-bold break-words md:text-4xl">{title}</h1>
            {description && <p className="mt-2 leading-7 text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {help && <HelpCallout {...help} />}
        {children}
      </main>
    </div>
  );
}

/** A card-like section with a heading. */
export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn('rounded-2xl border border-white/10 bg-white/[.055] p-4 md:p-5', className)}
    >
      {title && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
            {Icon && <Icon size={18} aria-hidden="true" className="text-violet-300" />}
            {title}
          </h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Free-text chips (tags): type and press Enter or comma; Backspace on an empty box removes the last. */
export function ChipInput({
  label,
  values,
  onChange,
  placeholder,
  id,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const generated = useId();
  const inputId = id || generated;
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && !values.includes(v));
    if (next.length) onChange([...values, ...next]);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-200">
        {label}
      </label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${label.toLowerCase()}`}>
          {values.map((chip) => (
            <li
              key={chip}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[.06] px-2.5 py-1 text-xs text-slate-100"
            >
              {chip}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== chip))}
                aria-label={`Remove ${chip}`}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={inputId}
        value={text}
        placeholder={placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
        onBlur={() => text.trim() && add(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
        }}
        className="w-full rounded-md border border-white/15 bg-white/[.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400 focus:outline-none"
      />
    </div>
  );
}

const STATE_LABEL: Record<ItemState, string> = {
  pinned: 'Pinned',
  excluded: 'Excluded',
  rule: 'By rule',
  out: 'Not included',
};
const STATE_TONE: Record<ItemState, string> = {
  pinned: 'border-amber-300/30 bg-amber-400/10 text-amber-200',
  excluded: 'border-rose-300/30 bg-rose-400/10 text-rose-200',
  rule: 'border-teal-300/30 bg-teal-400/10 text-teal-200',
  out: 'border-white/10 bg-white/[.04] text-slate-400',
};

export function StateBadge({ state }: { state: ItemState }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATE_TONE[state])}>
      {STATE_LABEL[state]}
    </span>
  );
}

/** Pin / Exclude / Back to automatic for one item in one view. */
export function StateActions({
  state,
  name,
  busy,
  onChange,
}: {
  state: ItemState;
  name: string;
  busy?: boolean;
  onChange: (state: 'pinned' | 'excluded' | 'auto') => void;
}) {
  const small = 'h-9 px-2.5 text-xs';
  if (state === 'pinned' || state === 'excluded')
    return (
      <Button size="sm" variant="outline" className={small} disabled={busy} onClick={() => onChange('auto')}>
        <RotateCcw size={14} aria-hidden="true" />
        Back to automatic<span className="sr-only">: {name}</span>
      </Button>
    );
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" className={small} disabled={busy} onClick={() => onChange('pinned')}>
        <Pin size={14} aria-hidden="true" />
        Pin<span className="sr-only"> {name}</span>
      </Button>
      {state === 'rule' && (
        <Button size="sm" variant="outline" className={small} disabled={busy} onClick={() => onChange('excluded')}>
          <Ban size={14} aria-hidden="true" />
          Exclude<span className="sr-only"> {name}</span>
        </Button>
      )}
    </div>
  );
}

/** Loading and error placeholders for signed-in showcase pages. */
export function LoadState({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  if (!error)
    return (
      <p role="status" className="py-10 text-center text-slate-400">
        Loading…
      </p>
    );
  return (
    <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-rose-100">
      <p>{error}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Copies a link, falling back to showing it when the clipboard is blocked. */
export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch {
    toast.message(url, { description: 'Copy this link to share it.' });
  }
}
