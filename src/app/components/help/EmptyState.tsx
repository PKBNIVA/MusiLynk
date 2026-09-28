import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../ui/utils';

/** An empty list: one icon, one friendly sentence, and at most one primary action. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-6 py-10 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-200">
        <Icon aria-hidden="true" size={24} />
      </span>
      <p className="mt-4 font-semibold text-white">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-400">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
