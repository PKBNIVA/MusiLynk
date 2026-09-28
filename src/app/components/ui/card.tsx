import * as React from 'react';

import { cn } from './utils';

const Card = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn(
        'bg-card/85 text-card-foreground flex flex-col gap-6 rounded-2xl border border-white/15 shadow-[0_16px_48px_rgba(0,0,0,.18)] backdrop-blur-sm transition-[border-color,box-shadow,transform]',
        className,
      )}
      {...props}
    />
  );
});
Card.displayName = 'Card';

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 pt-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Renders h4 by default (most cards sit deep enough in the page's heading tree for that to be
 * correct), but a card used higher up — e.g. the first heading after a page's own h1 — should
 * pass `level` so the document doesn't skip a level.
 */
function CardTitle({
  className,
  level = 4,
  ...props
}: React.ComponentProps<'div'> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Comp = `h${level}` as const as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return <Comp data-slot="card-title" className={cn('leading-none', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <p data-slot="card-description" className={cn('text-muted-foreground', className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6 [&:last-child]:pb-6', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-footer" className={cn('flex items-center px-6 pb-6 [.border-t]:pt-6', className)} {...props} />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
