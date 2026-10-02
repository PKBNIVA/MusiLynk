import { Sparkles } from 'lucide-react';
import { type AiPaywallError } from '../../lib/ai';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface AiPaywallDialogProps {
  /** The 402 AiPaywallError that triggered this dialog (AI_USAGE_LIMIT_REACHED / AI_FREE_PAUSED). */
  error: AiPaywallError;
  onClose: () => void;
}

const TITLES: Record<AiPaywallError['code'], string> = {
  AI_USAGE_LIMIT_REACHED: 'AI help is used up for now',
  AI_FREE_PAUSED: 'AI help is resting this month',
};

/**
 * Shown whenever an AI call answers 402: a friendly notice that AI help is used up (the
 * account's own free allowance) or resting for everyone this month (the platform-wide budget) —
 * never a purchase offer. Everything else on MusiLynk keeps working either way.
 */
export function AiPaywallDialog({ error, onClose }: AiPaywallDialogProps) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4" />
            {TITLES[error.code]}
          </DialogTitle>
          <DialogDescription>
            {error.code === 'AI_USAGE_LIMIT_REACHED' &&
              (error.period === 'month'
                ? "You've used this month's free AI help. It's back next month — everything else on MusiLynk works as usual."
                : "You've used your free AI help. Everything else on MusiLynk works as usual.")}
            {error.code === 'AI_FREE_PAUSED' && 'AI help is resting this month. Everything else works as usual.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
