import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { VerificationSummary } from '../lib/apiTypes';

const CHECK_LABELS: Record<string, string> = {
  identity: 'identity',
  work_links: 'work links',
  credits: 'credits',
  organization: 'organization',
};

/** "Verified by Verse: identity, work links · September 2026" (falls back to a plain label
 * when nothing was recorded — older, backfilled approvals). */
export function verifiedBadgeCopy(verification?: VerificationSummary | null): string {
  if (!verification) return 'Verified by Verse';
  const checks = (verification.checks || []).map((c) => CHECK_LABELS[c] || c).join(', ');
  const when = verification.verifiedAt
    ? new Date(verification.verifiedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;
  const parts = [checks, when].filter(Boolean);
  return parts.length ? `Verified by Verse: ${parts.join(' · ')}` : 'Verified by Verse';
}

/** The public Verified badge, with a tooltip saying what was actually checked and when. */
export function VerifiedBadge({
  verification,
  className,
}: {
  verification?: VerificationSummary | null;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={className}>
          Verified
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{verifiedBadgeCopy(verification)}</TooltipContent>
    </Tooltip>
  );
}
