/** One row of small count chips ("3 applications"). Labels are already pluralised by the caller. */
export function StatChips({
  items,
  className = '',
}: {
  items: { label: string; value: number }[];
  className?: string;
}) {
  return (
    <p className={`flex flex-wrap gap-2 text-sm ${className}`} data-testid="dashboard-stats">
      {items.map((t) => (
        <span key={t.label} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-slate-300">
          {t.value} {t.label}
        </span>
      ))}
    </p>
  );
}

export const plural = (n: number | undefined, word: string) => `${word}${n === 1 ? '' : 's'}`;
