import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MapPin, ShieldCheck, Star, Zap } from 'lucide-react';
import { DemoBadge } from '../DemoBadge';
import { VerifiedBadge } from '../VerifiedBadge';
import { UserAvatar } from '../kit/UserAvatar';
import { Card, CardContent } from '../ui/card';
import { FirstSample } from './FirstSample';
import { formatFromRate, formatReplyTime } from '../../lib/format';
import { personLines } from '../../lib/personLine';
import type { Professional } from '../../lib/apiTypes';

type Props = {
  person: Professional;
  /** Position in the list (data-list-item), used to move focus after "Load more". */
  index: number;
  /** Where the whole card opens (the name is the link; the card is its click target). */
  to: string;
  /** Beside the name, top right (e.g. the shortlist button). Sits above the card link. */
  aside?: ReactNode;
  /** Below the chips (e.g. Message / Compare). Sits above the card link. */
  footer?: ReactNode;
};

/** "4.8 (12)": the average and how many reviews it rests on. */
function Reviews({ average, count }: { average?: number | null; count: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${count} ${count === 1 ? 'review' : 'reviews'}`}>
      <Star size={13} aria-hidden="true" className="fill-amber-300 text-amber-300" />
      <span>
        {average?.toFixed(1)} ({count})
      </span>
      <span className="sr-only">{count === 1 ? 'review' : 'reviews'}</span>
    </span>
  );
}

/**
 * One musician in a list, the same in the public directory and in Find talent: avatar (photo, generated
 * art for demo accounts, or initials), name and trust marks, role · genres, city, then the facts a hirer
 * compares (from-price, reviews, bookings, reply time), one playable sample and at most three chips.
 */
export function TalentCard({ person: c, index, to, aside, footer }: Props) {
  const line = personLines({ ...c, location: null });
  const shown = `${line.primary} ${line.secondary.join(' ')}`.toLowerCase();
  const chips = [...new Set([...(c.instruments || []), ...(c.skills || [])])]
    .filter((x) => x && !shown.includes(x.toLowerCase()))
    .slice(0, 3);
  const reviews = c.reviewsCount ?? 0;
  const bookings = c.bookingsCount ?? 0;
  const from = formatFromRate(c);
  const reply = formatReplyTime(c.responseTimeMinutes);
  const facts = [
    from && (
      <span key="from" className="font-semibold text-emerald-200" data-testid="from-rate">
        {from}
      </span>
    ),
    reviews > 0 && <Reviews key="reviews" average={c.reviewsAverage} count={reviews} />,
    bookings > 0 && (
      <span key="bookings" data-testid="bookings-count">
        {bookings} {bookings === 1 ? 'booking' : 'bookings'}
      </span>
    ),
    reply && <span key="reply">{reply}</span>,
  ].filter(Boolean);
  return (
    <Card
      data-list-item={index}
      data-testid="talent-card"
      tabIndex={-1}
      className="verse-lift relative h-full min-w-0 border-white/10 bg-white/[.055] hover:bg-white/[.075] focus-within:ring-2 focus-within:ring-violet-400"
    >
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start gap-3">
          <UserAvatar id={c.id} name={c.name} size="lg" photoUrl={c.photoUrl} demo={c.demo} genres={c.genres} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <h2 className="min-w-0 break-words text-lg font-semibold">
                <Link to={to} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
                  {c.name}
                </Link>
              </h2>
              <DemoBadge show={c.demo} className="shrink-0" />
              {c.verified && <ShieldCheck size={16} aria-label="Verified" className="shrink-0 text-emerald-300" />}
              {c.verified && c.verificationTier === 'verified_pro' && (
                <span className="relative z-10 shrink-0">
                  <VerifiedBadge verification={c.verification} tier={c.verificationTier} />
                </span>
              )}
              {c.fastResponderBadge && (
                <Zap size={16} className="shrink-0 text-amber-300" aria-label="Fast responder this week" />
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-300">{line.primary || 'Music professional'}</p>
            {line.secondary.length > 0 && (
              <p className="mt-0.5 truncate text-sm text-slate-400">{line.secondary.slice(0, 3).join(' · ')}</p>
            )}
            {c.location && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-slate-400">
                <MapPin size={13} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{c.location}</span>
              </p>
            )}
          </div>
          {aside && <div className="relative z-10 shrink-0">{aside}</div>}
        </div>
        {facts.length > 0 && (
          <p
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300"
            data-testid="talent-facts"
          >
            {facts}
          </p>
        )}
        <div className="relative z-10 mt-3">
          <FirstSample id={c.id} />
        </div>
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="talent-chips">
            {chips.map((x) => (
              <span key={x} className="rounded-full bg-white/[.06] px-2.5 py-0.5 text-xs text-slate-300">
                {x}
              </span>
            ))}
          </div>
        )}
        {footer && <div className="relative z-10 mt-auto pt-4">{footer}</div>}
      </CardContent>
    </Card>
  );
}
