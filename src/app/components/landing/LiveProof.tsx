import { useEffect, useState } from 'react';
import { FileCheck2, Headphones, IndianRupee, Zap } from 'lucide-react';
import { loadPublicStats, proofItems, type ProofItem } from '../../lib/landing';

/**
 * Real numbers from GET /api/public/stats, shown only once they mean something. Until then (or if
 * the API can't be reached) this shows what Verse promises instead; never an invented figure.
 */
export function LiveProof() {
  const [items, setItems] = useState<ProofItem[] | null>(null);
  useEffect(() => {
    let active = true;
    loadPublicStats()
      .then((stats) => active && setItems(proofItems(stats)))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, []);

  if (items === null) return <div aria-hidden="true" className="min-h-40" />;
  return (
    <section aria-labelledby="proof-title" className="px-4 pb-16 sm:px-6 md:pb-24" data-testid="live-proof">
      <div className="mx-auto max-w-6xl rounded-3xl border border-white/10 bg-white/[.03] p-6 md:p-10">
        {items.length ? <Stats items={items} /> : <Promise />}
      </div>
    </section>
  );
}

function Stats({ items }: { items: ProofItem[] }) {
  return (
    <>
      <h2 id="proof-title" className="text-2xl font-black md:text-3xl">
        On Verse right now
      </h2>
      <dl className="mt-6 grid gap-6 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="flex flex-col-reverse">
            <dt className="mt-1 text-sm text-slate-300">{item.label}</dt>
            <dd className="text-4xl font-black tracking-tight">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-xs text-slate-400">
        Live counts of real accounts. Test and demo accounts are never counted.
      </p>
    </>
  );
}

function Promise() {
  const promises = [
    [Zap, 'Urgent requests show up for musicians and crew as soon as you post.'],
    [Headphones, 'You hear someone’s work before you message or book them.'],
    [FileCheck2, 'The fee and terms are agreed on Verse before anyone is booked.'],
    [IndianRupee, 'Posting a request is free.'],
  ] as const;
  return (
    <>
      <h2 id="proof-title" className="text-2xl font-black md:text-3xl">
        What you can count on
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {promises.map(([Icon, text]) => (
          <li key={text} className="flex gap-3 text-slate-200">
            <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-emerald-300" />
            <span className="leading-7">{text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
