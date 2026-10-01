import { isValidElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { Scene, type SceneName } from './scenes';

type ActionSpec = { label: string; to?: string; onClick?: () => void; variant?: 'default' | 'outline' };

type Props = {
  /** An illustration (the default look) ... */
  scene?: SceneName;
  /** ... or a single icon in a dashed box, for lists inside a page section. One of the two is required. */
  icon?: LucideIcon;
  title: string;
  /** A link/button spec, or your own element (`null` for none). Use `outline` when the page already has its one primary button. */
  action?: ActionSpec | ReactNode;
  /** One plain sentence. Use `children` when the sentence needs markup. */
  hint?: string;
  children?: ReactNode;
  /** Tighter padding for admin tables and side panels. */
  compact?: boolean;
  className?: string;
};

const isActionSpec = (action: unknown): action is ActionSpec =>
  typeof action === 'object' && action !== null && !isValidElement(action) && 'label' in action;

/** Illustration or icon + one sentence + one button. Nothing else. */
export function EmptyState({ scene, icon: Icon, title, action, hint, children, compact = false, className }: Props) {
  const boxed = !scene;
  const button = isActionSpec(action) ? (
    action.to ? (
      <Button asChild variant={action.variant}>
        <Link to={action.to}>{action.label}</Link>
      </Button>
    ) : (
      <Button variant={action.variant} onClick={action.onClick}>
        {action.label}
      </Button>
    )
  ) : (
    (action as ReactNode)
  );
  return (
    <div
      data-testid="empty-state"
      className={cn(
        'flex flex-col items-center text-center',
        boxed
          ? cn('rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-6', compact ? 'py-6' : 'py-10')
          : cn('px-4', compact ? 'py-6' : 'py-10'),
        className,
      )}
    >
      {scene ? (
        <Scene name={scene} className={cn('mx-auto', compact && 'h-20 w-auto')} />
      ) : (
        Icon && (
          <span
            className={cn(
              'grid place-items-center rounded-2xl bg-violet-500/15 text-violet-200',
              compact ? 'size-10' : 'size-12',
            )}
          >
            <Icon aria-hidden="true" size={compact ? 20 : 24} />
          </span>
        )
      )}
      {scene ? (
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      ) : (
        <p className="mt-4 font-semibold text-white">{title}</p>
      )}
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-400">{hint}</p>}
      {children && <div className="mt-1 max-w-md text-sm text-slate-400">{children}</div>}
      {button && <div className="mt-5">{button}</div>}
    </div>
  );
}
