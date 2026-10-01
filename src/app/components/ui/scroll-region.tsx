'use client';

import * as React from 'react';

import { cn } from './utils';

/**
 * A horizontally scrolling wrapper (wide tables, chip rows) that keyboard users can actually scroll:
 * once the content overflows it becomes focusable (tabIndex 0, role="region", named by `label`), so the
 * arrow keys work and axe's scrollable-region-focusable rule passes. When nothing overflows it adds no tab stop.
 *
 *   <ScrollRegion label="Rates by city"><table>…</table></ScrollRegion>
 */
export function ScrollRegion({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      {...props}
      className={cn('overflow-x-auto focus-visible:outline-2 focus-visible:outline-violet-400', className)}
      {...(overflowing ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}
    >
      {children}
    </div>
  );
}
