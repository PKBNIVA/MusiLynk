import { useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../ui/utils';

/**
 * Optional fields folded away under "More details (optional)". Content stays mounted while closed
 * (forceMount + hidden) so typed values and field ids survive, and it opens by itself when
 * `defaultOpen` says a field inside already has a value.
 */
export function MoreDetails({
  children,
  label = 'More details (optional)',
  defaultOpen = false,
  forceOpen = false,
  className,
}: {
  children: ReactNode;
  label?: string;
  defaultOpen?: boolean;
  /** Keeps the section open, e.g. while a field inside it has an error. */
  forceOpen?: boolean;
  className?: string;
}) {
  const [userOpen, setOpen] = useState(defaultOpen);
  const open = userOpen || forceOpen;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('rounded-xl border border-white/10', className)}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-200 hover:bg-white/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
        <SlidersHorizontal aria-hidden="true" size={16} className="text-violet-300" />
        <span className="flex-1">{label}</span>
        <ChevronDown aria-hidden="true" size={16} className={cn('transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent forceMount hidden={!open} className="space-y-4 border-t border-white/10 p-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A titled group of fields inside a long form. */
export function FormSection({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('space-y-4', className)}>
      <legend className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-violet-200">
        {Icon && <Icon aria-hidden="true" size={16} className="text-violet-300" />}
        {title}
      </legend>
      {description && <p className="-mt-1 text-sm text-slate-400">{description}</p>}
      {children}
    </fieldset>
  );
}
