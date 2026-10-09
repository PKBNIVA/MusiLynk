/**
 * Placeholder cards at the size of the real ones, shown while a list loads for the first time (a list the
 * visitor has already seen comes back from the client data cache instead), so nothing jumps when results arrive.
 */
export function ListSkeleton({
  label,
  count = 6,
  cardClassName = 'h-56',
  gridClassName = 'grid gap-4 md:grid-cols-2 lg:grid-cols-3',
}: {
  /** What is loading, for assistive technology: "Loading acts". */
  label: string;
  count?: number;
  cardClassName?: string;
  gridClassName?: string;
}) {
  return (
    <div role="status" aria-label={label} className="mt-6" data-testid="list-skeleton">
      <div aria-hidden="true" className={gridClassName}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`${cardClassName} animate-pulse rounded-xl border border-white/10 bg-white/[.04]`} />
        ))}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
