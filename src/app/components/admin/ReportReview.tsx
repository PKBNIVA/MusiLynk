import {useEffect, useState} from 'react';
import {AlertTriangle, Ban, MessageSquareWarning, X} from 'lucide-react';
import {Link} from 'react-router';
import {apiGet, apiPost} from '../../lib/api';
import {Button} from '../ui/button';
import {Badge} from '../ui/badge';
import {Label} from '../ui/label';
import {Textarea} from '../ui/textarea';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '../ui/dialog';

export type Decision = 'warn' | 'suspend' | 'dismiss';

type ExcerptMessage = {id: string; senderId: string; senderName: string; body: string; createdAt: string; safetyFlags?: string[]};
type ReportContext = {
  report: {id: string; entityType: string; entityId: string; reason: string; details?: string | null; status: string; createdAt: string; reporterId?: string | null; reporterName?: string | null};
  reportedUser: {id: string; name: string; email: string; role: string; status: string} | null;
  history: {reportsTotal: number; reportsLast90Days: number; openReports: number; warnings: number; suspensions: number; flaggedMessagesLast90Days: number} | null;
  conversation: {id: string; jobTitle?: string | null; messages: ExcerptMessage[]; earlierMessages: number; laterMessages: number} | null;
  guidelinesUrl: string;
};

// Plain-language names for ScamSignals codes (backend/app/services/scam_signals.rb).
export const SIGNAL_LABELS: Record<string, string> = {
  upfront_fee: 'Asks for an upfront fee',
  payment_details: 'Shares payment details to be paid',
  off_platform: 'Pushes the chat to WhatsApp/Telegram',
};

const NOTE_LIMIT = 1000;
const when = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const DECISIONS: Record<Decision, {label: string; busy: string; done: string; hint: string}> = {
  warn: {label: 'Warn user', busy: 'Warning…', done: 'Warning sent and report resolved', hint: 'Sends the user an in-app warning linking the community guidelines. Your note (optional) replaces the default text.'},
  suspend: {label: 'Suspend user', busy: 'Suspending…', done: 'User suspended and report resolved', hint: 'Suspends the account and signs it out everywhere. Your note is kept with the report.'},
  dismiss: {label: 'Dismiss report', busy: 'Dismissing…', done: 'Report dismissed', hint: 'Closes the report with no action against anyone. Your note is kept with the report.'},
};

/**
 * Admin-only review of one report: who was reported, their report history and, for reports
 * made from a conversation, the messages leading up to the report (the read is audit-logged).
 * Every decision closes the report and is recorded with it.
 */
export function ReportReview({reportId, onClose, onDecided}: {reportId: string | null; onClose: () => void; onDecided: (message: string) => void | Promise<void>}) {
  const [context, setContext] = useState<ReportContext | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    setContext(null);
    setError('');
    setNote('');
    setChoice(null);
    apiGet<ReportContext>(`/admin/reports/${reportId}/context`)
      .then(d => { if (!cancelled) setContext(d); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Unable to load this report.'); });
    return () => { cancelled = true; };
  }, [reportId]);

  const decide = async (decision: Decision) => {
    if (!reportId || pending) return;
    setPending(true);
    setError('');
    try {
      await apiPost(`/admin/reports/${reportId}/moderate`, {decision, note: note.trim() || undefined});
      await onDecided(DECISIONS[decision].done);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Action failed.');
    } finally {
      setPending(false);
    }
  };

  const target = context?.reportedUser;
  const history = context?.history;
  const canAct = !!target && target.role !== 'admin' && target.status !== 'deleted';
  const reporterId = context?.report.reporterId;

  return <Dialog open={!!reportId} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="bg-slate-950 border-white/15 text-white max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="report-review">
      <DialogHeader>
        <DialogTitle>Review report</DialogTitle>
        <DialogDescription className="text-slate-400">
          Decide against the <Link to={context?.guidelinesUrl || '/community-guidelines'} target="_blank" className="text-sky-300 underline underline-offset-4">community guidelines</Link>. Opening a conversation excerpt is recorded in the audit log.
        </DialogDescription>
      </DialogHeader>

      {!context && !error && <p role="status" className="text-sm text-slate-400">Loading report…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}

      {context && <div className="grid gap-5">
        <section aria-label="Report">
          <div className="text-rose-300 font-medium">{context.report.reason}</div>
          {context.report.details && <p className="text-sm text-slate-300 mt-1 whitespace-pre-wrap break-words">{context.report.details}</p>}
          <p className="text-xs text-slate-400 mt-1">Reported by {context.report.reporterName || 'Unknown'} · {when(context.report.createdAt)}</p>
        </section>

        {target ? <section aria-label="Reported user" className="rounded-lg border border-white/10 bg-white/[.03] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{target.name}</h3>
            <Badge variant="secondary">{target.role}</Badge>
            <Badge variant={target.status === 'active' ? 'secondary' : 'destructive'}>{target.status}</Badge>
          </div>
          <p className="text-xs text-slate-400 break-all">{target.email}</p>
          {history && <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-sm" data-testid="report-history">
            {([
              ['Reports (all time)', history.reportsTotal],
              ['Reports (90 days)', history.reportsLast90Days],
              ['Other open reports', history.openReports],
              ['Past warnings', history.warnings],
              ['Past suspensions', history.suspensions],
              ['Flagged messages (90 days)', history.flaggedMessagesLast90Days],
            ] as const).map(([label, value]) => <div key={label} className="rounded-md bg-white/[.04] p-2">
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className={`font-semibold ${value > 0 && label !== 'Reports (all time)' ? 'text-amber-200' : ''}`}>{value}</dd>
            </div>)}
          </dl>}
        </section> : <p className="text-sm text-slate-400">This report is not about a person or their listing, so it can only be dismissed.</p>}

        {context.conversation && <section aria-label="Conversation excerpt">
          <h3 className="font-semibold text-sm">Conversation before the report{context.conversation.jobTitle ? ` · ${context.conversation.jobTitle}` : ''}</h3>
          <p className="text-xs text-slate-400">
            Last {context.conversation.messages.length} messages before the report
            {context.conversation.earlierMessages > 0 ? ` (${context.conversation.earlierMessages} earlier not shown)` : ''}
            {context.conversation.laterMessages > 0 ? ` · ${context.conversation.laterMessages} sent after it` : ''}.
          </p>
          <ol className="mt-2 space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 max-h-80 overflow-y-auto" data-testid="report-excerpt">
            {context.conversation.messages.length === 0 && <li className="text-sm text-slate-400">No messages before the report.</li>}
            {context.conversation.messages.map(m => <li key={m.id} className={`text-sm rounded-md p-2 ${m.senderId === reporterId ? 'bg-white/[.03]' : 'bg-rose-500/10'}`}>
              <div className="text-xs text-slate-400">{m.senderName}{m.senderId === reporterId ? ' (reporter)' : ''} · {when(m.createdAt)}</div>
              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</div>
              {!!m.safetyFlags?.length && <div className="mt-1 flex flex-wrap gap-1">{m.safetyFlags.map(f => <Badge key={f} className="bg-amber-500/20 text-amber-100"><AlertTriangle size={11} aria-hidden="true" className="mr-1"/>{SIGNAL_LABELS[f] || f}</Badge>)}</div>}
            </li>)}
          </ol>
        </section>}

        {choice && <div className="grid gap-2">
          <Label htmlFor="report-decision-note">Note{choice === 'warn' ? ' to the user' : ' for the record'} (optional)</Label>
          <Textarea id="report-decision-note" value={note} onChange={e => setNote(e.target.value)} maxLength={NOTE_LIMIT} className="bg-white/5 border-white/15 min-h-24" autoFocus/>
          <p className="text-xs text-slate-400">{DECISIONS[choice].hint}</p>
        </div>}
      </div>}

      <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
        {choice ? <>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setChoice(null)}>Back</Button>
          <Button type="button" variant={choice === 'suspend' ? 'destructive' : 'default'} disabled={pending} aria-busy={pending} onClick={() => void decide(choice)} data-testid="confirm-decision">
            {pending ? DECISIONS[choice].busy : `Confirm: ${DECISIONS[choice].label.toLowerCase()}`}
          </Button>
        </> : <>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" variant="outline" disabled={!context} onClick={() => setChoice('dismiss')}><X size={14} aria-hidden="true" className="mr-1"/>Dismiss</Button>
          <Button type="button" variant="outline" disabled={!context || !canAct} onClick={() => setChoice('warn')}><MessageSquareWarning size={14} aria-hidden="true" className="mr-1"/>Warn</Button>
          <Button type="button" variant="destructive" disabled={!context || !canAct || target?.status === 'suspended'} onClick={() => setChoice('suspend')}><Ban size={14} aria-hidden="true" className="mr-1"/>Suspend</Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
