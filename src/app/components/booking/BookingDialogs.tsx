import { FieldHelp } from '../help/FieldHelp';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { errorMessage } from '../../lib/errors';

// Accessible replacements for window.prompt/confirm used by the booking & collaboration pages.
// Radix Dialog gives focus trapping, Escape to close and aria-modal labelling.

const panel = 'bg-slate-950 text-white border-white/15 max-h-[90dvh] overflow-y-auto';

type FormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  busyLabel?: string;
  busy?: boolean;
  canSubmit?: boolean;
  error?: string;
  wide?: boolean;
  /** A promise or reassurance under the buttons ("We reply within 2 hours"). */
  footerNote?: ReactNode;
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
};

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  busyLabel,
  busy,
  canSubmit = true,
  error,
  wide,
  footerNote,
  onSubmit,
  children,
}: FormDialogProps) {
  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !canSubmit) return;
    void onSubmit();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={`${panel} ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle className="text-2xl">{title}</DialogTitle>
            {description && <DialogDescription className="text-slate-400">{description}</DialogDescription>}
          </DialogHeader>
          {children}
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !canSubmit} aria-busy={busy}>
              {busy ? busyLabel || 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
          {footerNote && (
            <p data-testid="dialog-footer-note" className="text-center text-sm text-slate-300 sm:text-right">
              {footerNote}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type ConfirmRequest = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<unknown>;
};

/** Hook + element pair: `ask({...})` opens the dialog, the action runs on confirm and errors stay in the dialog. */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ask = (next: ConfirmRequest) => {
    setError('');
    setRequest(next);
  };
  const element = (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && !busy && setRequest(null)}>
      <DialogContent className={`${panel} sm:max-w-md`} role="alertdialog">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.description && (
            <DialogDescription className="text-slate-400">{request.description}</DialogDescription>
          )}
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setRequest(null)} disabled={busy}>
            Keep as is
          </Button>
          <Button
            variant={request?.destructive ? 'destructive' : 'default'}
            disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              if (!request) return;
              setBusy(true);
              setError('');
              try {
                await request.action();
                setRequest(null);
              } catch (e: unknown) {
                setError(errorMessage(e, 'Something went wrong. Try again.'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working…' : request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { ask, element };
}

export function Field({
  label,
  htmlFor,
  hint,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  /** A short explanation behind an info button beside the label. */
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-sm text-slate-300">
          {label}
        </label>
        {help && <FieldHelp topic={label}>{help}</FieldHelp>}
      </div>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const textareaClass = 'w-full min-h-24 rounded-xl bg-slate-900 border border-white/10 p-3 text-sm';
export const selectClass = 'w-full h-11 rounded-xl bg-slate-900 border border-white/10 px-3 text-sm';
