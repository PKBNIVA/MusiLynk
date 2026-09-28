import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Info, X, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

// Admin-local UI helpers. These are deliberately NOT shared with the public
// site's design system (a parallel effort is adding shared AppSelect/FieldHelp
// equivalents there) — everything here lives only under src/app/pages/admin*
// so the two refreshes never touch the same file.

/**
 * A dark-panel Radix dropdown that replaces the raw native <select>. Submits the
 * same `value` a native select would (labels are display-only, values are untouched).
 */
export function AdminSelect({
  value,
  onChange,
  options,
  placeholder,
  icon: Icon,
  className,
  triggerClassName,
  'aria-label': ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string; icon?: LucideIcon }[];
  placeholder?: string;
  icon?: LucideIcon;
  className?: string;
  triggerClassName?: string;
  'aria-label'?: string;
  id?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={`h-9 bg-slate-900 border-white/15 text-slate-100 ${triggerClassName ?? ''} ${className ?? ''}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {Icon && <Icon aria-hidden="true" size={14} className="text-slate-400 shrink-0" />}
          <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent className="bg-slate-900 border-white/15 text-slate-100">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="focus:bg-white/10">
            <span className="flex items-center gap-2">
              {o.icon && <o.icon aria-hidden="true" size={14} className="text-slate-400" />}
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A small info-icon tooltip for a non-obvious column, filter or action. */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          data-help-for={label}
          className="inline-flex text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 rounded-full align-middle"
        >
          <Info aria-hidden="true" size={13} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 bg-slate-800 text-slate-100">{text}</TooltipContent>
    </Tooltip>
  );
}

/** A row of 3+ actions collapsed into a single "more actions" menu, destructive items separated. */
export function RowActionsMenu({
  label,
  disabled,
  items,
}: {
  label: string;
  disabled?: boolean;
  items: { key: string; label: string; icon?: LucideIcon; destructive?: boolean; onSelect: () => void }[];
}) {
  const safe = items.filter((i) => !i.destructive);
  const danger = items.filter((i) => i.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled} aria-label={`Actions for ${label}`}>
          <MoreHorizontal aria-hidden="true" size={15} />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-900 border-white/15 text-slate-100">
        {safe.map((i) => (
          <DropdownMenuItem key={i.key} onSelect={i.onSelect} className="focus:bg-white/10">
            {i.icon && <i.icon aria-hidden="true" size={14} />}
            {i.label}
          </DropdownMenuItem>
        ))}
        {safe.length > 0 && danger.length > 0 && <DropdownMenuSeparator className="bg-white/10" />}
        {danger.map((i) => (
          <DropdownMenuItem key={i.key} variant="destructive" onSelect={i.onSelect}>
            {i.icon && <i.icon aria-hidden="true" size={14} />}
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page header for one tab / page: icon, title, one-line purpose. */
export function AdminPageHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
        <Icon aria-hidden="true" size={18} className="text-violet-300" />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
    </div>
  );
}

/**
 * Dismissible "how to use this tab" callout. Dismissal is remembered per tab in
 * localStorage; if storage is unavailable the callout simply shows every time.
 */
export function HowToCallout({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const key = `verse-admin-howto-dismissed:${storageKey}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    setDismissed(() => {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    });
  }, [key]);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* best effort only; the callout just reappears next visit */
    }
  };
  return (
    <Card className="bg-indigo-500/[.08] border-indigo-400/20 mb-4">
      <CardContent className="p-4 flex items-start gap-3 text-sm text-indigo-100">
        <Info aria-hidden="true" size={16} className="text-indigo-300 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">{children}</div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this tip"
          className="text-indigo-300 hover:text-white shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 rounded"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </CardContent>
    </Card>
  );
}

/** Empty state with an icon, a sentence and a next step, for lists that have nothing to show. */
export function EmptyState({ icon: Icon, text, hint }: { icon: LucideIcon; text: string; hint?: string }) {
  return (
    <Card className="bg-white/[.03] border-white/10">
      <CardContent className="p-10 text-center flex flex-col items-center gap-2">
        <Icon aria-hidden="true" size={26} className="text-slate-500" />
        <p className="text-slate-300">{text}</p>
        {hint && <p className="text-sm text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Subtle fixed decorative layer for the admin shell only: two blurred glows in a
 * cooler indigo/teal palette plus a faint grid. Never intercepts pointer events,
 * always hidden from assistive tech, and quiets its own motion when the person
 * prefers reduced motion. Contrast of foreground content is unaffected since it
 * sits behind everything at a very low opacity.
 */
export function AdminBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div
        className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[120px] motion-safe:animate-[pulse_12s_ease-in-out_infinite]"
        style={{ animationDuration: '12s' }}
      />
      <div
        className="absolute bottom-[-160px] right-[-120px] h-[560px] w-[560px] rounded-full bg-teal-500/15 blur-[130px] motion-safe:animate-[pulse_14s_ease-in-out_infinite]"
        style={{ animationDuration: '14s' }}
      />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  );
}
