import { Inbox, Plus } from 'lucide-react';
import { EmptyState } from '../components/help/EmptyState';
import { useCallback, useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
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
import type { ConversationCreated, EmployerApplication, Job } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';
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
      nav(`${base}/messages?conversation=${d.conversation.id}`);
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
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-6xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <h1 className="text-4xl font-bold">Applications</h1>
        <HelpCallout {...HELP.employerApplications} />
        <p className="text-slate-400 mt-2 mb-5">Review candidates only for opportunities you posted.</p>
        {jobs.length > 0 && (
          <div className="mb-6 max-w-md">
            <Label htmlFor="application-job-filter">Opportunity</Label>
            <AppSelect
              id="application-job-filter"
              value={jobId}
              onValueChange={setJobFilter}
              className="mt-2"
              options={[
                { value: '', label: 'All opportunities' },
                ...jobs.map((j) => ({ value: j.id, label: `${j.title} (${j.status})` })),
              ]}
            />
          </div>
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
          <EmptyState
            icon={Inbox}
            title={
              jobId ? `No applications for ${filteredJob?.title || 'this opportunity'} yet.` : 'No applications yet.'
            }
            action={
              jobId ? (
                <Button variant="outline" onClick={() => setJobFilter('')}>
                  Show all opportunities
                </Button>
              ) : (
                <Button asChild>
                  <Link to={postPath}>
                    <Plus aria-hidden="true" size={16} className="mr-2" />
                    Create an opportunity
                  </Link>
                </Button>
              )
            }
          >
            {jobId
              ? 'New applicants usually arrive within a few days of a listing going live.'
              : 'Post an opportunity and applicants will appear here with their samples and answers.'}
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {apps.map((a) => (
              <Card key={a.id} className="bg-white/[.06] border-white/10">
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row gap-5 justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold">{a.candidateName}</h2>
                        <Badge>{a.status}</Badge>
                      </div>
                      <div className="text-violet-300 text-sm mt-1">Applied for {a.jobTitle}</div>
                      {a.status === 'Interview Scheduled' && a.interviewDate && (
                        <div className="text-sm text-emerald-300 mt-1">
                          Interview: {new Date(a.interviewDate).toLocaleString()}
                        </div>
                      )}
                      <div className="text-sm text-slate-400 mt-2 break-words">
                        {a.candidateEmail} · {a.candidateLocation || 'Location not provided'} ·{' '}
                        {a.experience || 'Experience not provided'}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {a.skills?.map((s: string) => (
                          <Badge variant="secondary" key={s}>
                            {s}
                          </Badge>
                        ))}
                      </div>
                      {a.coverLetter && (
                        <p className="text-sm text-slate-300 mt-4 border-l-2 border-violet-500 pl-3 whitespace-pre-line break-words">
                          {a.coverLetter}
                        </p>
                      )}
                      {a.screeningAnswers?.length > 0 && (
                        <div className="mt-4 text-sm space-y-2">
                          <div className="text-slate-500">Screening responses</div>
                          <dl className="space-y-2">
                            {a.screeningAnswers.map((x, i: number) => {
                              const { question, answer } = screeningPair(x, i);
                              return (
                                <div key={i} className="p-2 rounded bg-white/5 [overflow-wrap:anywhere]">
                                  <dt className="text-slate-400 text-xs">{question}</dt>
                                  <dd className={answer ? 'mt-1 whitespace-pre-line' : 'mt-1 italic text-slate-500'}>
                                    {answer || 'No answer'}
                                  </dd>
                                </div>
                              );
                            })}
                          </dl>
                        </div>
                      )}
                      {(a.recruiterNote || a.recruiterRating) && (
                        <div className="text-xs text-amber-200 mt-3">
                          Internal: {a.recruiterRating ? `${a.recruiterRating}/5 · ` : ''}
                          {a.recruiterNote}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap lg:flex-col gap-2 lg:w-52">
                      <Button className="tap-target-44" size="sm" onClick={() => message(a.candidateId, a.jobId)}>
                        Message
                      </Button>
                      <Button
                        className="tap-target-44"
                        size="sm"
                        variant="outline"
                        disabled={!!updating[a.id]}
                        onClick={() =>
                          setNotes({
                            id: a.id,
                            name: a.candidateName,
                            note: a.recruiterNote || '',
                            rating: a.recruiterRating ? String(a.recruiterRating) : '',
                          })
                        }
                      >
                        Rate / note
                      </Button>
                      {(a.allowedNextStatuses || []).map((s: string) => (
                        <Button
                          key={s}
                          className="tap-target-44"
                          size="sm"
                          variant={s === 'Rejected' ? 'outline' : 'secondary'}
                          disabled={!!updating[a.id]}
                          aria-busy={!!updating[a.id]}
                          onClick={() => status(a, s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
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
      </main>
    </div>
  );
}
