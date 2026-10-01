import { PlayChip } from '../kit/PlayChip';
import { useFirstSample } from '../../lib/useFirstSample';

/** One play chip for a person's first public work sample, or a muted "No samples". */
export function FirstSample({ id, className = '' }: { id: string; className?: string }) {
  const { ref, sample, done } = useFirstSample(id);
  return (
    <div ref={ref} className={`min-h-8 ${className}`}>
      {sample ? <PlayChip sample={sample} /> : done ? <span className="text-xs text-slate-500">No samples</span> : null}
    </div>
  );
}
