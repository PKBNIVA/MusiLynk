import { Sparkles } from 'lucide-react';
import { useAiUsage } from '../../lib/ai';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export interface AiCreditsBadgeProps {
  className?: string;
}

/**
 * A small hint next to the AI buttons showing how much of the account's own free AI help is
 * left — never a "credits" number. `period` is "lifetime" for talent tasks (profile headline
 * and bio) or "month" for hirer tasks (job description and screening questions).
 */
export function AiCreditsBadge({ className }: AiCreditsBadgeProps) {
  const { usage } = useAiUsage();
  if (!usage) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-200 ${className || ''}`}
          data-testid="ai-credits-badge"
        >
          <Sparkles aria-hidden="true" className="size-3" />
          AI help: {usage.remaining} of {usage.limit} left
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {usage.period === 'month' ? 'Resets at the start of next month.' : 'A one-time allowance for your account.'}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
