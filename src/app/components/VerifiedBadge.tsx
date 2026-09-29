import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { VerificationSummary, VerificationTier } from '../lib/apiTypes';

const CHECK_LABELS: Record<string, string> = {
  identity: 'identity',
  work_links: 'work links',
  credits: 'credits',
  organization: 'organization',
};

const PRO_NOTE = 'Verified Pro: 3+ completed jobs on Verse with reviews.';

/** "Verified by Verse: identity, work links · Sep 2026" (falls back to a plain label
 * when nothing was recorded — older, backfilled approvals). Verified Pro adds one line. */
export function verifiedBadgeCopy(verification?: VerificationSummary | null, tier?: VerificationTier | null): string {
  const base = baseCopy(verification);
  return tier === 'verified_pro' ? `${PRO_NOTE} ${base}` : base;
}

function baseCopy(verification?: VerificationSummary | null): string {
  if (!verification) return 'Verified by Verse';
  const checks = (verification.checks || []).map((c) => CHECK_LABELS[c] || c).join(', ');
  const when = verification.verifiedAt
    ? new Date(verification.verifiedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;
  const parts = [checks, when].filter(Boolean);
  return parts.length ? `Verified by Verse: ${parts.join(' · ')}` : 'Verified by Verse';
}

/** The public Verified badge, with a tooltip saying what was actually checked and when.
 * `tier="verified_pro"` shows the "Verified Pro" variant. */
export function VerifiedBadge({
  verification,
  tier,
  className,
}: {
  verification?: VerificationSummary | null;
  tier?: VerificationTier | null;
  className?: string;
}) {
  const pro = tier === 'verified_pro';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          className={pro ? `bg-amber-400/15 text-amber-200 ${className ?? ''}`.trim() : className}
          data-tier={pro ? 'verified_pro' : 'verified'}
        >
          {pro ? 'Verified Pro' : 'Verified'}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{verifiedBadgeCopy(verification, tier)}</TooltipContent>
    </Tooltip>
  );
}
