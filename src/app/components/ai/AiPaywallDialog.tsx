import { Sparkles } from 'lucide-react';
import { type AiPaywallError } from '../../lib/ai';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface AiPaywallDialogProps {
  /** The 402 AiPaywallError that triggered this dialog (AI_CREDITS_EXHAUSTED / AI_FREE_PAUSED / AI_HARD_PAUSED). */
  error: AiPaywallError;
  onClose: () => void;
  /** Starts the Verse AI Plus subscribe flow. Omit to hide that offer (e.g. billing disabled). */
  onSubscribePlus?: () => void;
  /** Starts a top-up purchase flow. Omit to hide top-up offers (e.g. billing disabled). */
  onBuyTopup?: (pack: string) => void;
  /** Hides both offers regardless of the handlers above — pass when AI_BILLING_ENABLED is off. */
  billingEnabled?: boolean;
}

const TITLES: Record<AiPaywallError['code'], string> = {
  AI_CREDITS_EXHAUSTED: "You're out of AI credits",
  AI_FREE_PAUSED: 'Free AI credits are paused for now',
  AI_HARD_PAUSED: 'AI assist is paused for everyone right now',
};

/**
 * Shown whenever an AI call answers 402: explains why (out of credits, or the free/hard spend
 * guard), and offers Verse AI Plus or a credit top-up — hidden entirely when AI_BILLING_ENABLED
 * is off, since nothing can be purchased yet.
 */
export function AiPaywallDialog({
  error,
  onClose,
  onSubscribePlus,
  onBuyTopup,
  billingEnabled = true,
}: AiPaywallDialogProps) {
  const showOffers = billingEnabled && error.code !== 'AI_HARD_PAUSED';
  const resetsAt = error.resetsAt ? new Date(error.resetsAt) : undefined;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4" />
            {TITLES[error.code]}
          </DialogTitle>
          <DialogDescription>
            {error.code === 'AI_CREDITS_EXHAUSTED' &&
              `Your account's AI credits are used up for this period${
                resetsAt ? ` — they refresh on ${resetsAt.toLocaleDateString()}` : ''
              }.`}
            {error.code === 'AI_FREE_PAUSED' &&
              'Free AI usage across Verse has hit this month’s limit. Verse AI Plus and top-up credits keep working.'}
            {error.code === 'AI_HARD_PAUSED' &&
              'AI assist has hit this month’s usage limit and will be back next month.'}
          </DialogDescription>
        </DialogHeader>

        {typeof error.balance === 'number' && (
          <p className="text-sm text-slate-400" data-testid="ai-paywall-balance">
            Current balance: {error.balance} credits
          </p>
        )}

        {showOffers && error.upgradeOptions && (
          <div className="flex flex-col gap-2">
            {onSubscribePlus && (
              <Button type="button" onClick={onSubscribePlus} className="justify-between">
                <span>Verse AI Plus</span>
                <span>
                  ₹{error.upgradeOptions.aiPlus.priceInr}/mo · {error.upgradeOptions.aiPlus.creditsPerMonth} credits
                </span>
              </Button>
            )}
            {onBuyTopup &&
              Object.entries(error.upgradeOptions.topups).map(([pack, offer]) => (
                <Button
                  type="button"
                  key={pack}
                  variant="outline"
                  onClick={() => onBuyTopup(pack)}
                  className="justify-between"
                >
                  <span>Top up</span>
                  <span>
                    ₹{offer.priceInr} · {offer.credits} credits
                  </span>
                </Button>
              ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
