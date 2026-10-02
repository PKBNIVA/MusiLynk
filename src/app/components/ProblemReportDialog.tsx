import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Monitor, X } from 'lucide-react';
import { Field, FormDialog, textareaClass } from './booking/BookingDialogs';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { api, hasAccessToken } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatNumber } from '../lib/format';
import { getRecentErrors } from '../lib/recentErrors';
import {
  buildProblemReportForm,
  canCaptureScreen,
  captureScreen,
  checkScreenshot,
  collectContext,
  DESCRIPTION_MAX,
  EXPECTED_MAX,
  fitScreenshot,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_TYPES,
  type ReportContext,
} from '../lib/problemReport';

// "Report a problem": what happened (required), what they expected, a screenshot (a file, or a
// capture of this page where the browser can), and the context we would attach, shown before
// sending with a checkbox to leave it out. Signed-out visitors also give an email so we can reply.
// Opened by openProblemReport() (lib/problemReportEvent.ts) and loaded on demand.

const ROLE_LABEL: Record<string, string> = {
  jobseeker: 'Musician or crew',
  employer: 'Hirer',
  admin: 'Admin',
};

type SendResult = { id: string; screenshotSaved?: boolean };

export default function ProblemReportDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The signed-in role, when the caller knows it. */
  role?: string;
}) {
  const id = useId();
  const signedIn = hasAccessToken();
  const fileInput = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<null | { screenshotKept: boolean }>(null);
  const [context, setContext] = useState<ReportContext | null>(null);

  // A fresh form, and a fresh look at the page, every time the dialog opens.
  useEffect(() => {
    if (!open || capturing) return;
    setDescription('');
    setExpected('');
    setHoneypot('');
    setScreenshot(null);
    setIncludeContext(true);
    setError('');
    setSent(null);
    setContext(collectContext(getRecentErrors()));
    // Reset only when it opens; `capturing` closing and reopening it must keep the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewUrl = useMemo(() => (screenshot ? URL.createObjectURL(screenshot) : null), [screenshot]);
  useEffect(() => () => (previewUrl ? URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    const fitted = await fitScreenshot(file);
    const check = checkScreenshot(fitted);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setScreenshot(fitted);
  }

  async function capture() {
    setError('');
    // Hide this dialog so it is not in the picture; the form keeps what was typed.
    setCapturing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const file = await captureScreen();
      if (file) await chooseFile(file);
    } catch {
      setError('We could not capture this page. Attach a screenshot instead.');
    } finally {
      setCapturing(false);
    }
  }

  async function submit() {
    if (!description.trim()) {
      setError('Tell us what happened.');
      return;
    }
    if (!signedIn && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) {
      setError('Add your email so we can reply.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<SendResult>('/problem-reports', {
        method: 'POST',
        body: buildProblemReportForm({
          description,
          expected,
          email: signedIn ? undefined : email,
          screenshot,
          context: includeContext ? context : null,
          honeypot,
        }),
        timeoutMs: 30_000,
      });
      setSent({ screenshotKept: !screenshot || result.screenshotSaved !== false });
    } catch (e: unknown) {
      setError(errorMessage(e, 'We could not send your report. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const contextRows: [string, string][] = context
    ? [
        ['Page', context.page],
        ['App version', context.release],
        ['Browser and device', `${context.browser}, ${context.os}`],
        ['Screen size', `${context.viewport.width} × ${context.viewport.height}`],
        ...(signedIn ? ([['Account type', (role && ROLE_LABEL[role]) || 'Signed in']] as [string, string][]) : []),
      ]
    : [];

  if (sent) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-slate-950 text-white border-white/15 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Thanks, we have your report</DialogTitle>
            <DialogDescription className="text-slate-400">
              {sent.screenshotKept
                ? 'We read every one, and we will email you if we need more.'
                : 'We could not keep the screenshot, so tell us in words anything we should see. We read every report.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FormDialog
      open={open && !capturing}
      onOpenChange={onOpenChange}
      title="Report a problem"
      description="Tell us what went wrong. A real person reads every report."
      submitLabel="Send report"
      busyLabel="Sending…"
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <Field label="What happened?" htmlFor={`${id}-what`} hint={`Up to ${formatNumber(DESCRIPTION_MAX)} characters.`}>
        <textarea
          id={`${id}-what`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          required
          aria-required="true"
          className={textareaClass}
        />
      </Field>
      <Field label="What did you expect? (optional)" htmlFor={`${id}-expected`}>
        <textarea
          id={`${id}-expected`}
          value={expected}
          maxLength={EXPECTED_MAX}
          onChange={(e) => setExpected(e.target.value)}
          className={`${textareaClass} min-h-16`}
        />
      </Field>
      {!signedIn && (
        <Field label="Your email" htmlFor={`${id}-email`} hint="So we can reply. We do not add you to any list.">
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-required="true"
          />
        </Field>
      )}
      {/* A trap for bots: invisible and unreachable for people. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-slate-300" id={`${id}-shot`}>
          Screenshot (optional)
        </p>
        {previewUrl && screenshot ? (
          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-900 p-2">
            <img
              src={previewUrl}
              alt="Preview of your screenshot"
              className="max-h-32 max-w-[60%] rounded-lg object-contain"
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate text-slate-300">{screenshot.name}</p>
              <p className="text-xs text-slate-400">{Math.max(1, Math.round(screenshot.size / 1024))} KB</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setScreenshot(null)}>
                <X size={14} className="mr-1" aria-hidden="true" />
                Remove screenshot
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-shot`}>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={14} className="mr-1" aria-hidden="true" />
              Attach a screenshot
            </Button>
            {canCaptureScreen() && (
              <Button type="button" variant="outline" size="sm" onClick={() => void capture()}>
                <Monitor size={14} className="mr-1" aria-hidden="true" />
                Capture this page
              </Button>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={SCREENSHOT_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a screenshot file"
          data-testid="problem-report-file"
          onChange={(e) => {
            void chooseFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-slate-400">
          PNG, JPEG or WebP, up to {SCREENSHOT_MAX_BYTES / 1024 / 1024} MB. Anything on the screen is visible to us, so
          hide anything private first.
        </p>
      </div>

      <fieldset className="space-y-2 rounded-xl border border-white/10 p-3" data-testid="problem-report-context">
        <legend className="px-1 text-sm text-slate-300">Details we will attach</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="mt-0.5 accent-violet-500"
          />
          <span>Include these details to help us find the problem</span>
        </label>
        {contextRows.length > 0 && (
          <dl
            className={`grid gap-x-3 gap-y-1 text-xs ${includeContext ? 'text-slate-300' : 'text-slate-500 line-through'}`}
          >
            {contextRows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-2">
                <dt className="text-slate-400">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {context && context.errors.length > 0 && (
          <details className={`text-xs ${includeContext ? 'text-slate-300' : 'text-slate-500'}`}>
            <summary className="cursor-pointer">
              {context.errors.length} recent error {context.errors.length === 1 ? 'message' : 'messages'}
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {context.errors.map((message, index) => (
                <li key={index} className="break-words">
                  {message}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="flex items-center gap-1 text-xs text-slate-400">
          <Camera size={12} aria-hidden="true" />
          We never attach your passwords, saved data or what you typed in other forms.
        </p>
      </fieldset>
    </FormDialog>
  );
}
