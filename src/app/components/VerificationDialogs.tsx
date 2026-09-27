import {useEffect, useId, useState} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './ui/dialog';
import {Button} from './ui/button';
import {Field, FormDialog} from './booking/BookingDialogs';

// Accessible replacements for the window.prompt calls on the profile page.

const inputClass = 'w-full h-11 rounded-xl bg-slate-900 border border-white/10 px-3 text-sm aria-[invalid=true]:border-rose-400';

/** Same rule as the backend's SafeHttpUrlValidator: http(s), a host, and no user:password part. */
export function evidenceUrlError(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Add a link to your proof, for example your official website or a credit page.';
  let url: URL;
  try { url = new URL(trimmed); } catch { return 'Enter a full link starting with https:// (or http://).'; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return 'Enter a full link starting with https:// (or http://).';
  if (url.username || url.password) return 'Remove the username or password from the link.';
  if (trimmed.length > 2048) return 'That link is too long (2,048 characters at most).';
  return '';
}

export function VerificationRequestDialog({open, onOpenChange, onSubmit}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolve to close the dialog; throw to keep it open and show the error inside it. */
  onSubmit: (evidenceUrl: string) => Promise<unknown>;
}) {
  const id = useId();
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setUrl(''); setInvalid(''); setError(''); }
  }, [open]);

  async function submit() {
    const problem = evidenceUrlError(url);
    setInvalid(problem);
    if (problem) {
      document.getElementById(`${id}-url`)?.focus();
      return;
    }
    setBusy(true); setError('');
    try {
      await onSubmit(url.trim());
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || 'Unable to send your request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request professional verification"
      description="Share one public link that proves your professional work. Our team reviews it before adding the verified badge."
      submitLabel="Submit for review"
      busyLabel="Submitting…"
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <Field label="Proof URL" htmlFor={`${id}-url`} hint="An official website, credit page, label or studio page, professional profile or another verifiable source.">
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          value={url}
          onChange={e => { setUrl(e.target.value); if (invalid) setInvalid(''); }}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id}-url-error` : undefined}
          className={inputClass}
        />
        {invalid && <p id={`${id}-url-error`} className="text-sm text-rose-300">{invalid}</p>}
      </Field>
    </FormDialog>
  );
}

/** Development only: the API returns the email-verification link instead of sending mail. */
export function DebugLinkDialog({link, onClose}: {link: string | null; onClose: () => void}) {
  return (
    <Dialog open={Boolean(link)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="bg-slate-950 text-white border-white/15 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Development verification link</DialogTitle>
          <DialogDescription className="text-slate-400">Email delivery is off in this environment, so open the link directly.</DialogDescription>
        </DialogHeader>
        <a href={link || undefined} className="break-all text-violet-300 underline">{link}</a>
        <DialogFooter>
          <Button type="button" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
