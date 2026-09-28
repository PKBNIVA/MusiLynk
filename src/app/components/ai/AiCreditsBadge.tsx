import { Sparkles } from 'lucide-react';
import { useAiUsage } from '../../lib/ai';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export interface AiCreditsBadgeProps {
  className?: string;
}

/** A small badge showing the signed-in account's AI credits balance, with the reset date on hover. */
export function AiCreditsBadge({ className }: AiCreditsBadgeProps) {
  const { usage } = useAiUsage();
  if (!usage) return null;

  const resetsAt = new Date(usage.resetsAt);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-200 ${className || ''}`}
          data-testid="ai-credits-badge"
        >
          <Sparkles aria-hidden="true" className="size-3" />
          {usage.balance} AI credits
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          Resets {resetsAt.toLocaleDateString()} · {usage.plan} plan
          {typeof usage.monthlyAllowance === 'number' ? ` · ${usage.monthlyAllowance}/mo allowance` : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
