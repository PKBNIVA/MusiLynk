import { MapPin } from 'lucide-react';
import { formatRates, type Portfolio, type PortfolioMember } from '../../lib/showcase';

/** What a visitor (or an employer, once applied) sees: the effective fields and the chosen work. */
export function PortfolioPreview({ portfolio, members }: { portfolio: Portfolio; members: PortfolioMember[] }) {
  const rates = formatRates(portfolio.rates);
  return (
    <div data-testid="portfolio-preview">
      <p className="text-xs uppercase tracking-wider text-slate-500">{portfolio.ownerName}</p>
      <p className="mt-1 text-lg font-semibold text-white">{portfolio.headline || portfolio.title}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
        {portfolio.city && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} aria-hidden="true" />
            {portfolio.city}
          </span>
        )}
        {rates && <span>{rates}</span>}
      </div>
      {(portfolio.genres || []).length > 0 && (
        <p className="mt-2 text-xs text-violet-200">{(portfolio.genres || []).join(' · ')}</p>
      )}
      {portfolio.bio && <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-300">{portfolio.bio}</p>}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {members.length} piece{members.length === 1 ? '' : 's'} of work
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {members.slice(0, 8).map((m) => (
          <li key={m.itemId} className="rounded-xl border border-white/10 bg-black/20 p-2.5">
            <p className="line-clamp-2 text-sm font-medium text-white">{m.item.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {m.source === 'pinned' ? 'Pinned' : [m.item.type || m.item.kind, m.item.year].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
      {members.length > 8 && <p className="mt-2 text-xs text-slate-500">and {members.length - 8} more</p>}
    </div>
  );
}
