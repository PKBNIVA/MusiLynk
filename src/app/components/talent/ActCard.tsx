import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { usePrefetchIntent } from '../../lib/useCachedGet';
import { MapPin, ShieldCheck } from 'lucide-react';
import { DemoBadge } from '../DemoBadge';
import { CoverArt } from '../media/CoverArt';
import { UploadImage } from '../media/UploadImage';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { formatMoney } from '../../lib/format';
import type { Act } from '../../lib/apiTypes';
import { optionLabel } from '../ui/option-labels';

type Props = {
  act: Act;
  index: number;
  to: string;
  /** Shown after the name when two acts share it (the owner's name). */
  nameSuffix?: string;
  /** Below the facts (e.g. "Request availability"). Sits above the card link. */
  footer?: ReactNode;
};

/**
 * The act's picture: its uploaded photo (never on a demo act) or generated cover art. The photo is a
 * `<picture>` of the generated variants sized for a card (or the page header on the act's own page).
 */
export function ActCover({
  act,
  height,
  placement = 'card',
}: {
  act: Act;
  height: number;
  placement?: 'card' | 'header';
}) {
  const [failed, setFailed] = useState(false);
  const photo = !act.demo && act.photo_url && !failed ? act.photo_url : null;
  return (
    <div className="relative w-full overflow-hidden bg-white/5" style={{ height }} data-testid="act-cover">
      {photo ? (
        <UploadImage
          image={act.photo?.src === photo ? act.photo : null}
          src={photo}
          alt=""
          placement={placement}
          priority={placement === 'header'}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <CoverArt seed={act.id} genres={act.genres} size="fill" bars={40} className="block" />
      )}
    </div>
  );
}

/** One bookable act in a list: cover (photo or generated art), name, type · city, from-price, lineup size and genres. */
export function ActCard({ act: a, index, to, nameSuffix, footer }: Props) {
  // Hover, focus or a first touch warms the cache for the act page (dataCache.ts).
  const prefetchAct = usePrefetchIntent(to.startsWith('/acts/') ? `/public/acts/${encodeURIComponent(a.id)}` : null);
  const members = a.members?.length || 0;
  const from = a.min_fee ? `from ${formatMoney(a.min_fee, a.currency || 'INR')}` : '';
  return (
    <Card
      data-list-item={index}
      data-testid="act-card"
      tabIndex={-1}
      className="musilynk-lift relative h-full min-w-0 gap-0 overflow-hidden border-white/10 bg-white/[.055] p-0 hover:bg-white/[.075] focus-within:ring-2 focus-within:ring-violet-400"
    >
      <ActCover act={a} height={112} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 text-lg font-semibold break-words" data-testid="act-name">
            <Link
              to={to}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              {...prefetchAct}
            >
              {a.name}
            </Link>
            {nameSuffix && <span className="font-normal text-slate-400"> · {nameSuffix}</span>}
          </h2>
          <DemoBadge show={a.demo} className="shrink-0" />
          {(a.verified || a.ownerVerified) && (
            <ShieldCheck aria-label="Verified" className="shrink-0 text-emerald-300" size={16} />
          )}
        </div>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-slate-400">
          <span className="truncate text-violet-300">{optionLabel(a.act_type)}</span>
          {a.city && (
            <>
              <span aria-hidden="true">·</span>
              <MapPin size={13} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{a.city}</span>
            </>
          )}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
          {from ? (
            <span className="font-semibold text-emerald-200" data-testid="from-rate">
              {from}
            </span>
          ) : (
            <span className="text-slate-400">Ask for a quote</span>
          )}
          {a.ownerName && <span>By {a.ownerName}</span>}
          {members > 0 && (
            <span>
              {members} {members === 1 ? 'member' : 'members'}
            </span>
          )}
        </p>
        {a.genres?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {a.genres.slice(0, 3).map((x) => (
              <Badge variant="secondary" key={x}>
                {x}
              </Badge>
            ))}
          </div>
        )}
        {footer && <div className="relative z-10 mt-auto pt-4">{footer}</div>}
      </div>
    </Card>
  );
}
