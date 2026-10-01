import { useEffect, useState } from 'react';
import { BadgeCheck, Clock3, IndianRupee, type LucideIcon } from 'lucide-react';
import { loadPublicStats, proofItems, type ProofItem } from '../../lib/landing';

// What Verse promises, in three lines. These are policies, not statistics, so they are always true
// and always shown. The response promise is the urgent-request one (backend/config/urgent.yml).
const PROMISES: readonly (readonly [LucideIcon, string])[] = [
  [BadgeCheck, 'Verified by the Verse team'],
  [Clock3, 'Reply within 2 hours, 9 am–11 pm IST'],
  [IndianRupee, 'Free to post · musicians never pay'],
];

/**
 * The promise strip, plus real numbers from GET /api/public/stats once they mean something (see
 * PROOF_THRESHOLDS; demo accounts are left out). Nothing here is invented: with no counts, or
 * if the API can't be reached, only the promises show.
 */
export function LiveProof() {
  const [items, setItems] = useState<ProofItem[]>([]);
  useEffect(() => {
    let active = true;
    loadPublicStats()
      .then((stats) => active && setItems(proofItems(stats)))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-labelledby="proof-title"
      className="border-y border-white/10 bg-white/[.025] px-4 py-8 sm:px-6"
      data-testid="live-proof"
    >
      <div className="mx-auto max-w-6xl">
        <h2 id="proof-title" className="sr-only">
          What you can count on
        </h2>
        <ul className="grid gap-4 md:grid-cols-3" data-testid="promise-strip">
          {PROMISES.map(([Icon, text]) => (
            <li key={text} className="flex items-center gap-3 font-semibold text-slate-100">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
                <Icon aria-hidden="true" size={19} />
              </span>
              {text}
            </li>
          ))}
        </ul>
        {items.length > 0 && <Stats items={items} />}
      </div>
    </section>
  );
}

function Stats({ items }: { items: ProofItem[] }) {
  return (
    <div className="mt-8 border-t border-white/10 pt-6">
      <h3 className="text-lg font-black">On Verse right now</h3>
      <dl className="mt-4 grid gap-6 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="flex flex-col-reverse">
            <dt className="mt-1 text-sm text-slate-300">{item.label}</dt>
            <dd className="text-4xl font-black tracking-tight">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-slate-400">Live counts of real accounts.</p>
    </div>
  );
}
