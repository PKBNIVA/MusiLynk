import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { Field, FormDialog, textareaClass } from './booking/BookingDialogs';
import { errorMessage } from '../lib/errors';
import { formatNumber } from '../lib/format';

// Accessible replacement for the window.prompt report flows (a conversation partner, a job
// listing). The reason is picked from a fixed list so moderators get consistent categories;
// free-text details are optional. Sends the same POST /reports payload as before:
// {entityType, entityId, reason (<= 200 chars), details (<= 5000 chars)}.

export const REPORT_REASONS = [
  'Harassment',
  'Asks for payment',
  'Spam or scam',
  'Unsafe contact request',
  'Misleading opportunity',
  'Other',
] as const;

export const REPORT_DETAILS_MAX = 4000;

export type ReportSubmission = { reason: string; details: string };

export function ReportDialog({
  open,
  onOpenChange,
  title,
  description,
  reasons = REPORT_REASONS,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  reasons?: readonly string[];
  /** Resolve to close the dialog; throw to keep it open and show the error inside it. */
  onSubmit: (report: ReportSubmission) => Promise<unknown>;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setDetails('');
      setError('');
    }
  }, [open]);

  async function submit() {
    if (!reason) {
      setError('Choose a reason for your report.');
      return;
    }
    if (reason === 'Other' && !details.trim()) {
      setError('Tell us briefly what is wrong when you choose “Other”.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ reason, details: details.trim().slice(0, REPORT_DETAILS_MAX) });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Unable to send your report. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      submitLabel="Send report"
      busyLabel="Sending…"
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <fieldset className="space-y-2" aria-describedby={`${id}-hint`}>
        <legend className="text-sm text-slate-300 mb-2">Reason</legend>
        {reasons.map((option) => (
          <label
            key={option}
            className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm cursor-pointer has-[:checked]:border-violet-400 has-[:checked]:bg-violet-500/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-400"
          >
            <input
              type="radio"
              name={`${id}-reason`}
              value={option}
              checked={reason === option}
              onChange={() => {
                setReason(option);
                setError('');
              }}
              className="accent-violet-500"
            />
            {option}
          </label>
        ))}
        <p id={`${id}-hint`} className="text-xs text-slate-400">
          Reports are reviewed against our{' '}
          <Link to="/community-guidelines" target="_blank" rel="noopener" className="underline text-violet-300">
            community guidelines<span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </p>
      </fieldset>
      <Field
        label="Details (optional)"
        htmlFor={`${id}-details`}
        hint={`What happened? Up to ${formatNumber(REPORT_DETAILS_MAX)} characters.`}
      >
        <textarea
          id={`${id}-details`}
          value={details}
          maxLength={REPORT_DETAILS_MAX}
          onChange={(e) => setDetails(e.target.value)}
          className={textareaClass}
        />
      </Field>
    </FormDialog>
  );
}
