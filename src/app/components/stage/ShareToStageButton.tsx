import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../ui/button';
import { useAuth } from '../../lib/authContext';
import { Composer } from './Composer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

export interface ShareToStageButtonProps {
  kind: 'job_share' | 'portfolio_share';
  id: string;
  /** A short label for the thing being shared, shown in the dialog title. */
  label?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  className?: string;
}

/**
 * "Share to the Stage" for a job or a portfolio item: opens the post composer prefilled with
 * the share. Mounted on job detail pages here; exported so the portfolio library can mount it
 * on a work sample too.
 */
export function ShareToStageButton({ kind, id, label, variant = 'outline', className }: ShareToStageButtonProps) {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isAuthenticated)
    return (
      <Button asChild type="button" variant={variant} size="sm" className={className}>
        <Link to="/auth/jobseeker">
          <Share2 aria-hidden="true" size={16} />
          Share to the Stage
        </Link>
      </Button>
    );

  return (
    <>
      <Button type="button" variant={variant} size="sm" className={className} onClick={() => setOpen(true)}>
        <Share2 aria-hidden="true" size={16} />
        Share to the Stage
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-950 text-white border-white/15 max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Share {label || (kind === 'job_share' ? 'this job' : 'this work')} to the Stage</DialogTitle>
          </DialogHeader>
          <Composer
            prefill={kind === 'job_share' ? { sharedJobId: id } : { sharedPortfolioItemId: id }}
            onPosted={() => setOpen(false)}
            compact
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
