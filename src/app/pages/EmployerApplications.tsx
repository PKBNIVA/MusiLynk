import { ChevronDown, ListOrdered, Mail, MessageCircleQuestion, Sparkles, ThumbsDown } from 'lucide-react';
import { EmptyState } from '../components/kit/EmptyState';
import { personLines } from '../lib/personLine';
import { UserAvatar } from '../components/kit/UserAvatar';
import { FirstSample } from '../components/talent/FirstSample';
import { useCallback, useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../lib/authContext';
import { FormDialog, fieldClass } from '../components/HiringDialog';
import { errorMessage } from '../lib/errors';
import { formatWhen } from '../lib/format';
import { shareListing } from '../lib/shareListing';
import type { ConversationCreated, EmployerApplication, Job } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';
import { isAiPaywallError, suggestAi, useAiTaskEnabled, type AiPaywallError } from '../lib/ai';
import { AiCreditsBadge } from '../components/ai/AiCreditsBadge';
import { AiPaywallDialog } from '../components/ai/AiPaywallDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

// The application's snapshot of the portfolio/resume chosen at apply time (materialsSnapshot —
// see backend/docs/api-pages-portfolios-resumes.md §8). Not in apiTypes yet, so kept local here.
type MaterialsSnapshot = {
  capturedAt?: string;
  portfolio?: {
    title?: string;
    headline?: string | null;
    itemCount?: number;
    items?: { itemId: string; item?: { title?: string; type?: string } }[];
  } | null;
  resume?: {
    title?: string;
    headline?: string | null;
    summary?: string | null;
    entryCount?: number;
    sections?: string[];
    pdf?: { url: string; filename?: string } | null;
  } | null;
};
type ApplicationWithMaterials = EmployerApplication & { materials?: MaterialsSnapshot | null };

type CandidateSummary = { bullets: string[]; fit: string };
type SummaryState = { loading: boolean; open: boolean; error?: string; data?: CandidateSummary };
type RankResult = { score: number; reason: string };
type DraftKind = 'outreach_message' | 'interview_questions' | 'rejection_note';
type DraftState = { kind: DraftKind; app: EmployerApplication; text: string; loading: boolean; error?: string };

const DRAFT_TITLES: Record<DraftKind, string> = {
  outreach_message: 'Draft invite',
  interview_questions: 'Interview questions',
  rejection_note: 'Draft kind rejection',
};

/** The applicant's email is only shown once the hirer has moved them forward. */
const EMAIL_VISIBLE_STATUSES = ['Shortlisted', 'Interview Scheduled', 'Offer', 'Hired'];

/** Parses candidate_summary's fixed output shape: "- bullet" lines, then a final "Fit: ..." line. */
function parseCandidateSummary(text: string): CandidateSummary {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = rows.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
  const fitLine = rows.find((l) => /^fit:/i.test(l));
  return { bullets, fit: fitLine ? fitLine.replace(/^fit:\s*/i, '') : '' };
}

// datetime-local value for "now", in the viewer's time zone.
const localNow = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
/** Stored answers read "Question :: answer"; older rows may be a bare answer or another value. */
function screeningPair(value: unknown, index: number) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const at = text.indexOf(' :: ');
  if (at >= 0) return { question: text.slice(0, at), answer: text.slice(at + 4).trim() };
  if (text.endsWith(' ::')) return { question: text.slice(0, -3), answer: '' };
  return { question: `Question ${index + 1}`, answer: text.trim() };
}

/** "8 yrs" from the free-text experience field, or the text itself when it has no number. */
function yearsLabel(experience?: string | null) {
  const text = (experience || '').trim();
  if (!text) return '';
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isFinite(n) ? `${n} yrs` : text;
}

/** The cover note: italic, two lines, "More" reveals the rest. */
function CoverNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 text-sm italic text-slate-300">
      <p className={`whitespace-pre-line break-words ${open ? '' : 'line-clamp-2'}`}>“{text}”</p>
      {text.length > 120 && (
        <button
          type="button"
          className="not-italic text-violet-300 hover:text-white"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

export default function EmployerApplications() {
  const nav = useNavigate(),
    { user } = useAuth(),
    [params, setParams] = useSearchParams();
  const base = user?.role === 'jobseeker' ? '/jobseeker' : '/employer',
    postPath = user?.role === 'jobseeker' ? '/jobseeker/hiring/post' : '/employer/post-job';
  const jobId = params.get('jobId') || '';
  const [apps, setApps] = useState<EmployerApplication[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  /* Applications with a status/note update in flight; their actions are disabled until it settles. */ const [
    updating,
    setUpdating,
  ] = useState<Record<string, boolean>>({});
  const markUpdating = (id: string, on: boolean) =>
    setUpdating((xs) => {
      const next = { ...xs };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  const [interview, setInterview] = useState<{ id: string; name: string; date: string } | null>(null),
    [notes, setNotes] = useState<{ id: string; name: string; note: string; rating: string } | null>(null);
  // Recruiter AI: candidate_summary is cached per applicant in view state; rank_applicants keys
  // its results by applicationId so re-filtering the job list never mixes up two jobs' scores.
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const [rank, setRank] = useState<{
    loading: boolean;
    error?: string;
    results: Record<string, RankResult>;
    sortActive: boolean;
  }>({ loading: false, results: {}, sortActive: false });
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [paywall, setPaywall] = useState<AiPaywallError | null>(null);
  const summarizeEnabled = useAiTaskEnabled('candidate_summary');
  const rankEnabled = useAiTaskEnabled('rank_applicants');
  const outreachEnabled = useAiTaskEnabled('outreach_message');
  const interviewQEnabled = useAiTaskEnabled('interview_questions');
  const rejectionEnabled = useAiTaskEnabled('rejection_note');
  const recruiterAiAvailable = outreachEnabled || interviewQEnabled || rejectionEnabled;

  async function summarize(a: EmployerApplication) {
    setSummaries((s) => ({ ...s, [a.id]: { ...s[a.id], loading: true, error: undefined, open: true } }));
    try {
      const screeningAnswers = (a.screeningAnswers || [])
        .map((x, i) => screeningPair(x, i).answer)
        .filter(Boolean) as string[];
      const result = await suggestAi('candidate_summary', {
        jobId: a.jobId,
        candidateHeadline: a.headline || '',
        candidateSkills: a.skills || [],
        candidateSummary: a.coverLetter || '',
        jobTitle: a.jobTitle,
        screeningAnswers,
      });
      setSummaries((s) => ({
        ...s,
        [a.id]: { loading: false, open: true, data: parseCandidateSummary(result.suggestion) },
      }));
    } catch (e: unknown) {
      if (isAiPaywallError(e)) {
        setPaywall(e);
        setSummaries((s) => ({ ...s, [a.id]: { ...s[a.id], loading: false } }));
        return;
      }
      setSummaries((s) => ({
        ...s,
        [a.id]: { loading: false, open: true, error: errorMessage(e, 'Could not summarize this candidate.') },
      }));
    }
  }
  function toggleSummary(a: EmployerApplication) {
    const existing = summaries[a.id];
    if (!existing || (!existing.data && !existing.loading)) void summarize(a);
    else setSummaries((s) => ({ ...s, [a.id]: { ...s[a.id], open: !s[a.id]?.open } }));
  }

  async function rankApplicants() {
    const filteredJob = jobs.find((j) => j.id === jobId);
    const candidates = apps.filter((a) => a.jobId === jobId);
    if (!filteredJob || !candidates.length || rank.loading) return;
    setRank((r) => ({ ...r, loading: true, error: undefined }));
    try {
      const result = await suggestAi('rank_applicants', {
        jobId: filteredJob.id,
        jobTitle: filteredJob.title,
        jobRequirements: filteredJob.requirements || '',
        applicants: candidates.map((a) =>
          JSON.stringify({
            id: a.id,
            headline: a.headline || '',
            skills: a.skills || [],
            summary: (a.coverLetter || '').slice(0, 300),
          }),
        ),
      });
      const parsed = JSON.parse(result.suggestion) as { applicationId: string; score: number; reason: string }[];
      const results: Record<string, RankResult> = {};
      parsed.forEach((p) => {
        results[p.applicationId] = { score: p.score, reason: p.reason };
      });
      setRank({ loading: false, results, sortActive: true, error: undefined });
    } catch (e: unknown) {
      if (isAiPaywallError(e)) {
        setPaywall(e);
        setRank((r) => ({ ...r, loading: false }));
        return;
      }
      setRank((r) => ({ ...r, loading: false, error: errorMessage(e, 'Could not rank applicants.') }));
    }
  }

  function openDraft(kind: DraftKind, a: EmployerApplication) {
    setDraft({ kind, app: a, text: '', loading: true });
    const context =
      kind === 'outreach_message'
        ? { jobId: a.jobId, jobTitle: a.jobTitle, candidateHeadline: a.headline || '', notes: '' }
        : kind === 'interview_questions'
          ? { jobId: a.jobId, jobTitle: a.jobTitle, candidateHeadline: a.headline || '', focusAreas: a.skills || [] }
          : { jobId: a.jobId, jobTitle: a.jobTitle, candidateHeadline: a.headline || '' };
    suggestAi(kind, context)
      .then((r) => setDraft((d) => (d && d.app.id === a.id ? { ...d, text: r.suggestion, loading: false } : d)))
      .catch((e: unknown) => {
        if (isAiPaywallError(e)) {
          setPaywall(e);
          setDraft(null);
          return;
        }
        setDraft((d) =>
          d && d.app.id === a.id ? { ...d, loading: false, error: errorMessage(e, 'Could not draft this.') } : d,
        );
      });
  }
  async function sendDraft() {
    if (!draft || !draft.text.trim() || sendingDraft) return;
    setSendingDraft(true);
    try {
      const c = await apiPost<ConversationCreated>('/conversations', {
        candidateId: draft.app.candidateId,
        jobId: draft.app.jobId,
      });
      await apiPost(`/conversations/${c.conversation.id}/messages`, { body: draft.text });
      toast.success(`Sent to ${draft.app.candidateName}`);
      setDraft(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not send this message.'));
    } finally {
      setSendingDraft(false);
    }
  }

  const load = useCallback(
    () =>
      apiGet<{ applications?: EmployerApplication[] }>(
        `/employer/applications?${new URLSearchParams(jobId ? { jobId } : {})}`,
      )
        .then((d) => {
          setApps(d.applications || []);
          setLoadError('');
        })
        .catch((e: unknown) => setLoadError(errorMessage(e, 'Applications could not be loaded.')))
        .finally(() => setLoading(false)),
    [jobId],
  );
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
  useEffect(() => {
    apiGet<{ jobs?: Job[] }>('/employer/jobs')
      .then((d) => setJobs(d.jobs || []))
      .catch(() => {});
  }, []);
  async function message(candidateId: string, jobId: string) {
    try {
      const d = await apiPost<ConversationCreated>('/conversations', { candidateId, jobId });
      nav(`${base}/messages?c=${d.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function update(id: string, body: Record<string, unknown>, success: string) {
    if (updating[id]) return false;
    markUpdating(id, true);
    try {
      await apiPatch(`/employer/applications/${id}`, body);
      toast.success(success);
      await load();
      return true;
    } catch (e: unknown) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      markUpdating(id, false);
    }
  }
  function status(a: EmployerApplication, s: string) {
    if (s === 'Interview Scheduled') {
      setInterview({ id: a.id, name: a.candidateName, date: '' });
      return;
    }
    void update(a.id, { status: s }, `Marked ${s}`);
  }
  async function saveInterview() {
    if (!interview) return;
    const parsed = new Date(interview.date);
    if (!interview.date || Number.isNaN(parsed.getTime())) {
      toast.error('Choose a valid interview date and time');
      return;
    }
    if (
      await update(
        interview.id,
        { status: 'Interview Scheduled', interviewDate: parsed.toISOString() },
        'Marked Interview Scheduled',
      )
    )
      setInterview(null);
  }
  async function saveNotes() {
    if (!notes) return;
    if (
      await update(
        notes.id,
        { recruiterNote: notes.note, recruiterRating: notes.rating ? Number(notes.rating) : null },
        'Recruiter notes saved',
      )
    )
      setNotes(null);
  }
  const setJobFilter = (v: string) => setParams(v ? { jobId: v } : {}, { replace: true });
  const filteredJob = jobs.find((j) => j.id === jobId);
  // One primary button per screen: "Shortlisted" on the first applicant who can be shortlisted.
  const primaryShortlistId = apps.find((a) => (a.allowedNextStatuses || []).includes('Shortlisted'))?.id;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-6xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <PageHeader
          title="Applicants"
          actions={<AiCreditsBadge />}
          help={<HelpCallout {...HELP.employerApplications} />}
        />
        {jobs.length > 0 && (
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <div className="max-w-md flex-1 min-w-56">
              <Label htmlFor="application-job-filter">Opportunity</Label>
              <AppSelect
                id="application-job-filter"
                value={jobId}
                onValueChange={(v) => {
                  setJobFilter(v);
                  setRank({ loading: false, results: {}, sortActive: false });
                }}
                className="mt-2"
                options={[
                  { value: '', label: 'All opportunities' },
                  ...jobs.map((j) => ({ value: j.id, label: `${j.title} (${j.status})` })),
                ]}
              />
            </div>
            {jobId && rankEnabled && apps.some((a) => a.jobId === jobId) && (
              <Button
                type="button"
                variant="outline"
                disabled={rank.loading}
                aria-busy={rank.loading}
                onClick={() => void rankApplicants()}
              >
                <ListOrdered aria-hidden="true" size={15} className="mr-2" />
                {rank.loading ? 'Ranking…' : 'Rank applicants'}
              </Button>
            )}
            {Object.keys(rank.results).length > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={rank.sortActive}
                  onChange={(e) => setRank((r) => ({ ...r, sortActive: e.target.checked }))}
                />
                Sort by AI estimate
              </label>
            )}
          </div>
        )}
        {rank.error && (
          <p role="alert" className="mb-4 text-sm text-rose-300">
            {rank.error}
          </p>
        )}
        {loading ? (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-10 text-center text-slate-400" role="status">
              Loading applications…
            </CardContent>
          </Card>
        ) : loadError ? (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-10 text-center" role="alert">
              <p className="text-rose-300">{loadError}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  load();
                }}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : apps.length === 0 ? (
          (() => {
            // Share what is live: the filtered opportunity, else the newest live one.
            const live = filteredJob ?? jobs.find((j) => j.status === 'published');
            if (!jobs.length)
              return (
                <EmptyState
                  scene="applicants"
                  title="Post an opportunity to receive applicants"
                  action={{ label: 'Post an opportunity', to: postPath }}
                />
              );
            return (
              <EmptyState
                scene="applicants"
                title={filteredJob ? `No applicants for ${filteredJob.title} yet` : 'No applicants yet'}
                hint="Most listings get their first applicant within 48 hours. Sharing the link speeds that up."
                action={
                  live && live.status === 'published'
                    ? { label: 'Share this opportunity', onClick: () => void shareListing(live) }
                    : filteredJob
                      ? { label: 'Show all opportunities', onClick: () => setJobFilter('') }
                      : { label: 'Post an opportunity', to: postPath }
                }
              />
            );
          })()
        ) : (
          <div className="space-y-4">
            {(rank.sortActive
              ? [...apps].sort((a, b) => (rank.results[b.id]?.score ?? -1) - (rank.results[a.id]?.score ?? -1))
              : apps
            ).map((a) => {
              const materials = (a as ApplicationWithMaterials).materials;
              const summary = summaries[a.id];
              const aiRank = rank.results[a.id];
              return (
                <Card key={a.id} className="bg-white/[.06] border-white/10">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row gap-5 justify-between">
                      <div className="flex min-w-0 flex-1 gap-4">
                        <UserAvatar id={a.candidateId} name={a.candidateName} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-semibold">
                              <Link
                                to={`/professionals/${encodeURIComponent(a.candidateId)}`}
                                className="hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
                              >
                                {a.candidateName}
                              </Link>
                            </h2>
                            <Badge>{a.status}</Badge>
                            {aiRank && (
                              <Badge
                                className="bg-violet-500/15 text-violet-200"
                                title="AI estimate, not a hiring decision"
                              >
                                AI estimate: {aiRank.score}/100
                              </Badge>
                            )}
                          </div>
                          {aiRank && <p className="text-xs text-violet-300 mt-1">{aiRank.reason}</p>}
                          <div className="text-sm text-slate-300 mt-1 break-words">
                            {(() => {
                              const line = personLines({
                                headline: a.headline,
                                genres: a.genres,
                                location: a.candidateLocation || 'Location not provided',
                              });
                              return [line.primary, ...line.secondary.slice(0, 3), yearsLabel(a.experience)]
                                .filter(Boolean)
                                .join(' · ');
                            })()}
                          </div>
                          {EMAIL_VISIBLE_STATUSES.includes(a.status) && a.candidateEmail && (
                            <div className="text-xs text-slate-400 mt-1 break-all">
                              <a href={`mailto:${a.candidateEmail}`} className="underline hover:text-white">
                                {a.candidateEmail}
                              </a>
                            </div>
                          )}
                          <div className="text-slate-400 text-xs mt-1">Applied for {a.jobTitle}</div>
                          {a.status === 'Interview Scheduled' && a.interviewDate && (
                            <div className="text-sm text-emerald-300 mt-1">
                              Interview: {formatWhen(a.interviewDate)}
                            </div>
                          )}
                          <FirstSample id={a.candidateId} className="mt-3" />
                          {a.screeningAnswers?.length > 0 && (
                            <details className="mt-3 text-sm">
                              <summary className="cursor-pointer text-slate-300 hover:text-white">
                                Screening answers ({a.screeningAnswers.length})
                              </summary>
                              <dl className="mt-2 space-y-2">
                                {a.screeningAnswers.map((x, i: number) => {
                                  const { question, answer } = screeningPair(x, i);
                                  return (
                                    <div key={i} className="p-2 rounded bg-white/5 [overflow-wrap:anywhere]">
                                      <dt className="text-slate-400 text-xs">{question}</dt>
                                      <dd
                                        className={answer ? 'mt-1 whitespace-pre-line' : 'mt-1 italic text-slate-500'}
                                      >
                                        {answer || 'No answer'}
                                      </dd>
                                    </div>
                                  );
                                })}
                              </dl>
                            </details>
                          )}
                          {a.coverLetter && <CoverNote text={a.coverLetter} />}
                          {(a.recruiterNote || a.recruiterRating) && (
                            <div className="text-xs text-amber-200 mt-3">
                              Internal: {a.recruiterRating ? `${a.recruiterRating}/5 · ` : ''}
                              {a.recruiterNote}
                            </div>
                          )}
                          {materials && (materials.portfolio || materials.resume) && (
                            <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
                              {materials.portfolio && (
                                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                                  <div className="text-slate-500 text-xs">Portfolio sent with this application</div>
                                  <div className="font-medium mt-0.5">{materials.portfolio.title}</div>
                                  {materials.portfolio.headline && (
                                    <div className="text-slate-400 text-xs mt-0.5">{materials.portfolio.headline}</div>
                                  )}
                                  <div className="text-slate-400 text-xs mt-1">
                                    {materials.portfolio.itemCount ?? materials.portfolio.items?.length ?? 0} work
                                    sample
                                    {(materials.portfolio.itemCount ?? materials.portfolio.items?.length ?? 0) === 1
                                      ? ''
                                      : 's'}
                                  </div>
                                </div>
                              )}
                              {materials.resume && (
                                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                                  <div className="text-slate-500 text-xs">Resume sent with this application</div>
                                  <div className="font-medium mt-0.5">{materials.resume.title}</div>
                                  {materials.resume.summary && (
                                    <div className="text-slate-400 text-xs mt-0.5 line-clamp-2">
                                      {materials.resume.summary}
                                    </div>
                                  )}
                                  <div className="text-slate-400 text-xs mt-1">
                                    {(materials.resume.sections || []).join(', ') ||
                                      `${materials.resume.entryCount ?? 0} entries`}
                                    {materials.resume.pdf && (
                                      <>
                                        {' · '}
                                        <a
                                          className="underline underline-offset-2"
                                          href={materials.resume.pdf.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {materials.resume.pdf.filename || 'PDF'}
                                        </a>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {summarizeEnabled && summary?.open && (
                            <div
                              className="mt-4 rounded-lg border border-violet-400/20 bg-violet-500/[.06] p-3 text-sm"
                              aria-live="polite"
                            >
                              {summary.loading ? (
                                <p role="status" className="text-slate-400">
                                  Summarizing…
                                </p>
                              ) : summary.error ? (
                                <p role="alert" className="text-rose-300">
                                  {summary.error}
                                </p>
                              ) : summary.data ? (
                                <>
                                  <ul className="list-disc pl-4 space-y-1 text-slate-200">
                                    {summary.data.bullets.map((b, i) => (
                                      <li key={i}>{b}</li>
                                    ))}
                                  </ul>
                                  {summary.data.fit && <p className="mt-2 text-violet-200">Fit: {summary.data.fit}</p>}
                                  <p className="mt-2 text-xs text-slate-500">
                                    AI-written summary — review before relying on it.
                                  </p>
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap lg:flex-col gap-2 lg:w-52">
                        {(summarizeEnabled || recruiterAiAvailable) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button className="tap-target-44" size="sm" variant="outline">
                                <Sparkles aria-hidden="true" size={14} className="mr-2" />
                                AI help
                                <ChevronDown aria-hidden="true" size={14} className="ml-1" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {summarizeEnabled && (
                                <DropdownMenuItem onSelect={() => toggleSummary(a)}>
                                  <Sparkles aria-hidden="true" size={14} />
                                  Summarize
                                </DropdownMenuItem>
                              )}
                              {outreachEnabled && (
                                <DropdownMenuItem onSelect={() => openDraft('outreach_message', a)}>
                                  <Mail aria-hidden="true" size={14} />
                                  Draft invite
                                </DropdownMenuItem>
                              )}
                              {interviewQEnabled && (
                                <DropdownMenuItem onSelect={() => openDraft('interview_questions', a)}>
                                  <MessageCircleQuestion aria-hidden="true" size={14} />
                                  Interview questions
                                </DropdownMenuItem>
                              )}
                              {rejectionEnabled && (
                                <DropdownMenuItem onSelect={() => openDraft('rejection_note', a)}>
                                  <ThumbsDown aria-hidden="true" size={14} />
                                  Draft kind rejection
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {a.id === primaryShortlistId && (
                          <Button
                            className="tap-target-44"
                            size="sm"
                            disabled={!!updating[a.id]}
                            aria-busy={!!updating[a.id]}
                            onClick={() => status(a, 'Shortlisted')}
                          >
                            Shortlist
                          </Button>
                        )}
                        {(() => {
                          const moves = (a.allowedNextStatuses || []).filter(
                            (s: string) => !(a.id === primaryShortlistId && s === 'Shortlisted'),
                          );
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  className="tap-target-44"
                                  size="sm"
                                  variant="outline"
                                  disabled={!!updating[a.id]}
                                  aria-busy={!!updating[a.id]}
                                >
                                  Move to…
                                  <ChevronDown aria-hidden="true" size={14} className="ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {moves.map((s: string) => (
                                  <DropdownMenuItem key={s} onSelect={() => status(a, s)}>
                                    {s}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setNotes({
                                      id: a.id,
                                      name: a.candidateName,
                                      note: a.recruiterNote || '',
                                      rating: a.recruiterRating ? String(a.recruiterRating) : '',
                                    })
                                  }
                                >
                                  Rate / note
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        })()}
                        <Button
                          className="tap-target-44"
                          size="sm"
                          variant="outline"
                          onClick={() => message(a.candidateId, a.jobId)}
                        >
                          Message
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        <FormDialog
          open={!!interview}
          onOpenChange={(o) => {
            if (!o) setInterview(null);
          }}
          title="Schedule interview"
          description={
            interview
              ? `Pick when you will interview ${interview.name}. They are notified of the status change.`
              : undefined
          }
          submitLabel="Schedule interview"
          busy={!!(interview && updating[interview.id])}
          submitDisabled={!interview?.date}
          onSubmit={saveInterview}
        >
          <div>
            <Label htmlFor="interview-date">Interview date and time</Label>
            <input
              id="interview-date"
              type="datetime-local"
              required
              min={localNow()}
              value={interview?.date || ''}
              onChange={(e) => setInterview((x) => x && { ...x, date: e.target.value })}
              className={fieldClass}
            />
          </div>
        </FormDialog>
        <FormDialog
          open={!!notes}
          onOpenChange={(o) => {
            if (!o) setNotes(null);
          }}
          title="Rate and note"
          description={notes ? `Internal to your team; ${notes.name} never sees this.` : undefined}
          submitLabel="Save notes"
          busy={!!(notes && updating[notes.id])}
          onSubmit={saveNotes}
        >
          <div>
            <Label htmlFor="recruiter-note">Recruiter note</Label>
            <Textarea
              id="recruiter-note"
              maxLength={2000}
              value={notes?.note || ''}
              onChange={(e) => setNotes((x) => x && { ...x, note: e.target.value })}
              className="mt-2 bg-black/20 border-white/15 min-h-28"
            />
          </div>
          <div>
            <Label htmlFor="recruiter-rating">Internal rating</Label>
            <AppSelect
              id="recruiter-rating"
              value={String(notes?.rating || '')}
              onValueChange={(v) => setNotes((x) => x && { ...x, rating: v })}
              className="mt-2"
              options={[
                { value: '', label: 'No rating' },
                ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` })),
              ]}
            />
          </div>
        </FormDialog>
        <FormDialog
          open={!!draft}
          onOpenChange={(o) => {
            if (!o) setDraft(null);
          }}
          title={draft ? `${DRAFT_TITLES[draft.kind]} · ${draft.app.candidateName}` : ''}
          description="AI-written draft — edit it before sending. Nothing is sent until you choose Send."
          submitLabel={sendingDraft ? 'Sending…' : 'Send message'}
          busy={sendingDraft}
          submitDisabled={draft?.loading || !draft?.text.trim()}
          onSubmit={sendDraft}
        >
          <div aria-live="polite">
            {draft?.loading ? (
              <p role="status" className="text-sm text-slate-400">
                Writing a draft…
              </p>
            ) : draft?.error ? (
              <p role="alert" className="text-sm text-rose-300">
                {draft.error}
              </p>
            ) : (
              <>
                <Label htmlFor="ai-draft-text">Message</Label>
                <Textarea
                  id="ai-draft-text"
                  maxLength={5000}
                  value={draft?.text || ''}
                  onChange={(e) => setDraft((d) => d && { ...d, text: e.target.value })}
                  className="mt-2 bg-black/20 border-white/15 min-h-40"
                />
              </>
            )}
          </div>
        </FormDialog>
        {paywall && <AiPaywallDialog error={paywall} onClose={() => setPaywall(null)} />}
      </main>
    </div>
  );
}
