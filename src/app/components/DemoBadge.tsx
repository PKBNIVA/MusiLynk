/** Marks sample content created from the admin demo-data panel (API field `demo: true`). */
export function DemoBadge({ show, className = '' }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      data-testid="demo-badge"
      title="Sample content for previewing Verse. Not a real account."
      className={`inline-flex items-center rounded-full border border-white/15 px-1.5 py-px text-[10px] uppercase tracking-wide text-slate-400 ${className}`}
    >
      Demo
    </span>
  );
}
