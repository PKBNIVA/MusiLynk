import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { ReportDialog } from '../components/ReportDialog';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { toast } from 'sonner';
import { Bookmark, BookmarkCheck, Flag, MessageSquare, Send, FileText, ListChecks } from 'lucide-react';
import { errorMessage } from '../lib/errors';
import type { ConversationCreated, Job } from '../lib/apiTypes';
import { formatDate, formatNumber } from '../lib/format';
import { MoreDetails } from '../components/help/MoreDetails';
import { Field, FormError } from '../components/form/Field';
import { useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { JobHero } from '../components/JobHero';
import { SimilarJobs } from '../components/SimilarJobs';
import { ApplyMaterials, type Materials } from '../components/showcase/ApplyMaterials';
import { AiSuggestButton } from '../components/ai/AiSuggestButton';
import type { Portfolio, Resume } from '../lib/showcase';
import { ShareToStageButton } from '../components/stage/ShareToStageButton';
import { FEATURE_STAGE } from '../lib/features';
import { OwnerJobPanel } from '../components/OwnerJobPanel';
import { optionLabel } from '../components/ui/option-labels';

const COVER_MAX = 5_000;
const answerId = (i: number) => `screening-${i}`;

const title = (x?: string | null) => String(x || '').replace(/(^|\s)\S/g, (m) => m.toUpperCase());

export default function JobDetails() {
  const { id } = useParams(),
    nav = useNavigate(),
    { user } = useAuth();
  const [job, setJob] = useState<Job>(),
    [cover, setCover] = useState(''),
    [answers, setAnswers] = useState<Record<number, string>>({}),
    [loadError, setLoadError] = useState(''),
    [reporting, setReporting] = useState(false),
    [materials, setMaterials] = useState<Materials>({}),
    [chosen, setChosen] = useState<{ portfolio?: Portfolio; resume?: Resume }>({});
  const load = useCallback(() => {
    setLoadError('');
    return apiGet<{ job?: Job }>(`/jobs/${id}`)
      .then((d) => {
        if (!d?.job) throw new Error('Opportunity not found');
        setJob(d.job);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'This opportunity could not be loaded.')));
  }, [id]);
  useEffect(() => {
    setJob(undefined);
    load();
  }, [load]);
  // Field names are the control ids; the API names screening answers screeningAnswer0, 1, …
  const applyForm = useFormErrors<string>({
    ids: { coverLetter: 'cover-note' },
    apiFields: Object.fromEntries(
      (job?.screeningQuestions || []).map((_q: string, i: number) => [`screeningAnswer${i}`, answerId(i)]),
    ),
  });
  const applySubmit = useSubmitOnce();
  const busy = applySubmit.busy;
  const backTo = user?.role === 'employer' ? '/employer' : '/jobseeker/jobs';
  async function messageEmployer() {
    try {
      const d = await apiPost<ConversationCreated>('/conversations', { jobId: id });
      nav(`/jobseeker/messages?c=${d.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  function apply() {
    if (!job) return;
    void applySubmit.run(async () => {
      const questions: string[] = job.screeningQuestions || [];
      const missing: Record<string, string> = {};
      questions.forEach((q, i) => {
        if (!answers[i]?.trim()) missing[answerId(i)] = 'Answer this question to apply.';
      });
      if (cover.length > COVER_MAX) missing.coverLetter = `Keep the note under ${formatNumber(COVER_MAX)} characters.`;
      applyForm.setFormError('');
      if (applyForm.setErrors(missing)) {
        applyForm.focusFirst();
        return;
      }
      try {
        await apiPost(`/jobs/${id}/apply`, {
          coverLetter: cover,
          screeningAnswers: questions.map((_q, i) => answers[i].trim()),
          ...(materials.portfolioId ? { portfolioId: materials.portfolioId } : {}),
          ...(materials.resumeId ? { resumeId: materials.resumeId } : {}),
        });
        setJob({ ...job, applied: true });
        toast.success('Application submitted');
      } catch (e: unknown) {
        if (applyForm.setFromApi(e, 'Your application could not be sent. Try again.')) applyForm.focusFirst();
      }
    });
  }
  async function save() {
    if (!job) return;
    try {
      job.saved ? await apiDelete(`/saved-jobs/${id}`) : await apiPost(`/saved-jobs/${id}`);
      setJob({ ...job, saved: !job.saved });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function report({ reason, details }: { reason: string; details: string }) {
    await apiPost('/reports', { entityType: 'job', entityId: id, reason, ...(details ? { details } : {}) });
    toast.success('Report sent to moderation');
  }
  if (!job)
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navigation />
        {loadError ? (
          <main className="max-w-xl mx-auto px-5 pt-32 pb-16 text-center" role="alert">
            <h1 className="text-2xl font-bold">
              {/not found/i.test(loadError)
                ? 'This opportunity is no longer available'
                : 'This opportunity could not be loaded'}
            </h1>
            <p className="text-slate-400 mt-3">
              {/not found/i.test(loadError) ? 'It may have been filled, closed or removed by the hirer.' : loadError}
            </p>
            <div className="flex justify-center gap-2 mt-6">
              {!/not found/i.test(loadError) && (
                <Button variant="outline" onClick={() => load()}>
                  Retry
                </Button>
              )}
              <Button asChild>
                <Link to={backTo}>Back to opportunities</Link>
              </Button>
            </div>
          </main>
        ) : (
          <div className="pt-32 text-center text-slate-400">Loading opportunity…</div>
        )}
      </div>
    );
  // The poster sees their own listing's status and actions, not the apply panel (J-12).
  const isOwner = Boolean(user && job.employer_id === user.id);
  const asSeeker = user?.role === 'jobseeker' && !isOwner;
  const canApply = asSeeker && job.status !== 'closed' && !job.applied;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-44 lg:pb-16">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
          <div className="space-y-5">
            <Card className="bg-white/[.055] border-white/10">
              <CardContent className="p-6 md:p-8">
                <JobHero
                  job={job}
                  actions={FEATURE_STAGE && <ShareToStageButton kind="job_share" id={job.id} label={job.title} />}
                />
                {job.fitScore && job.fitScore >= 60 ? (
                  <p className="mt-3 text-sm text-slate-400">{job.fitScore}% profile fit</p>
                ) : null}
              </CardContent>
            </Card>
            <Card className="bg-white/[.055] border-white/10">
              <CardContent className="p-6 md:p-8">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FileText aria-hidden="true" size={20} className="text-violet-300" />
                  About the opportunity
                </h2>
                <p className="text-slate-300 mt-4 whitespace-pre-wrap leading-7">{job.description}</p>
                {job.requirements && (
                  <>
                    <h2 className="text-xl font-semibold mt-8 flex items-center gap-2">
                      <ListChecks aria-hidden="true" size={20} className="text-violet-300" />
                      Requirements
                    </h2>
                    <p className="text-slate-300 mt-4 whitespace-pre-wrap leading-7">{job.requirements}</p>
                  </>
                )}
                <div className="grid sm:grid-cols-2 gap-5 mt-8 pt-6 border-t border-white/10 text-sm">
                  <div>
                    <div className="text-slate-500 mb-1">Engagement</div>
                    <div>{optionLabel(job.type)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">Experience level</div>
                    <div>{title(job.experience_level || 'Not specified')}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">Genre / repertoire</div>
                    <div>{job.genre}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">Openings</div>
                    <div>{job.slots || 1}</div>
                  </div>
                  {job.start_date && (
                    <div>
                      <div className="text-slate-500 mb-1">Start date</div>
                      <div>{formatDate(job.start_date)}</div>
                    </div>
                  )}
                  {job.duration && (
                    <div>
                      <div className="text-slate-500 mb-1">Duration</div>
                      <div>{job.duration}</div>
                    </div>
                  )}
                </div>
                {job.skills?.length > 0 && (
                  <div className="mt-7">
                    <div className="text-sm text-slate-500 mb-2">Skills</div>
                    <div className="flex flex-wrap gap-2">
                      {job.skills.map((s: string) => (
                        <Badge key={s} variant="outline" className="border-white/15 text-slate-300">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            {asSeeker && <SimilarJobs job={job} basePath="/jobseeker/jobs" />}
          </div>
          <aside className="space-y-4">
            <Card id="apply-panel" className="bg-white/[.06] border-white/10 lg:sticky lg:top-24">
              <CardContent className="p-5">
                {isOwner && (
                  <OwnerJobPanel
                    job={job}
                    base={user?.role === 'jobseeker' ? '/jobseeker' : '/employer'}
                    onChanged={load}
                  />
                )}
                {asSeeker && (
                  <div className="flex gap-2 mb-5">
                    <Button variant="outline" className="flex-1" onClick={save}>
                      {job.saved ? (
                        <BookmarkCheck size={17} className="mr-2" />
                      ) : (
                        <Bookmark size={17} className="mr-2" />
                      )}
                      {job.saved ? 'Saved' : 'Save'}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Report opportunity" onClick={() => setReporting(true)}>
                      <Flag size={17} />
                    </Button>
                  </div>
                )}
                {job.status === 'closed' && !isOwner && (
                  <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-slate-300">
                    This opportunity has closed.
                  </div>
                )}
                {asSeeker && job.status !== 'closed' && (
                  <>
                    {job.applied ? (
                      <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 p-4 text-emerald-200">
                        <b>Application submitted</b>
                        <p className="text-sm mt-1 text-emerald-100/75">Track its status from Applications.</p>
                      </div>
                    ) : (
                      <>
                        <ApplyMaterials
                          base="/jobseeker"
                          value={materials}
                          onChange={setMaterials}
                          onDetails={setChosen}
                        />
                        {job.screeningQuestions?.length > 0 && (
                          <fieldset className="space-y-3 mb-4">
                            <legend className="text-sm font-medium mb-1">Screening questions</legend>
                            <p className="text-xs text-slate-400">
                              The hirer asks everyone these. Short, honest answers are best.
                            </p>
                            {job.screeningQuestions.map((q: string, i: number) => (
                              <Field
                                key={q}
                                id={answerId(i)}
                                label={q}
                                required
                                labelClassName="text-xs font-normal text-slate-300 [overflow-wrap:anywhere]"
                                error={applyForm.errors[answerId(i)]}
                              >
                                <Textarea
                                  value={answers[i] || ''}
                                  maxLength={COVER_MAX}
                                  onChange={(e) => {
                                    setAnswers({ ...answers, [i]: e.target.value });
                                    applyForm.clear(answerId(i));
                                  }}
                                  className="min-h-20 bg-black/20 border-white/15"
                                />
                              </Field>
                            ))}
                          </fieldset>
                        )}
                        <MoreDetails
                          label="Add a note to the hirer (optional)"
                          forceOpen={!!applyForm.errors.coverLetter}
                        >
                          <Field
                            id="cover-note"
                            label="Short note to the hirer"
                            optional
                            help="Two or three lines on why you fit, plus the one sample they should hear first. Your profile is sent automatically."
                            error={applyForm.errors.coverLetter}
                            count={cover.length}
                            maxLength={cover.length > COVER_MAX * 0.8 ? COVER_MAX : undefined}
                          >
                            <Textarea
                              value={cover}
                              maxLength={COVER_MAX}
                              onChange={(e) => {
                                setCover(e.target.value);
                                applyForm.clear('coverLetter');
                              }}
                              placeholder="Why this opportunity fits your work and what relevant proof should they review…"
                              className="min-h-32 bg-black/20 border-white/15"
                            />
                          </Field>
                          <AiSuggestButton
                            task="cover_letter"
                            value={cover}
                            getContext={() => ({
                              jobId: job.id,
                              jobTitle: job.title,
                              company: job.company,
                              jobDescription: (job.description || '').slice(0, 1500),
                              headline: chosen.portfolio?.headline || chosen.resume?.headline || undefined,
                              resumeSummary: (chosen.resume?.summary || '').slice(0, 1000) || undefined,
                            })}
                            onAccept={(text) => {
                              setCover(text);
                              applyForm.clear('coverLetter');
                            }}
                          />
                        </MoreDetails>
                        <FormError message={applyForm.formError} className="mt-3" />
                        <Button className="w-full mt-3" disabled={busy} aria-busy={busy} onClick={apply}>
                          <Send size={16} className="mr-2" />
                          {busy ? 'Applying…' : 'Apply now'}
                        </Button>
                        {job.portfolioRequired && (
                          <p className="text-xs text-amber-200/90 mt-2">
                            This opportunity requires at least one portfolio item.{' '}
                            <Link to="/jobseeker/library" className="underline">
                              Add work samples
                            </Link>
                          </p>
                        )}
                      </>
                    )}
                    <Button
                      variant="ghost"
                      className="w-full mt-2"
                      onClick={messageEmployer}
                      data-testid="message-employer"
                    >
                      <MessageSquare size={16} className="mr-2" />
                      Message hirer
                    </Button>
                  </>
                )}
                <div className="text-xs text-slate-500 mt-5 pt-4 border-t border-white/10">
                  <b className="text-slate-400">Trust note:</b>{' '}
                  {asSeeker
                    ? 'Never pay an application/audition fee through private channels. Use Report if the terms change materially or feel unsafe.'
                    : 'Only publish terms your organization is prepared to honor, and keep applicant communication on Verse.'}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
      {canApply && (
        <div className="fixed inset-x-3 bottom-[5.5rem] z-40 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-xl backdrop-blur lg:hidden">
          <Button
            className="w-full"
            onClick={() => document.getElementById('apply-panel')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Apply
          </Button>
        </div>
      )}
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        title="Report this opportunity"
        description="Tell our moderators what is wrong with this opportunity."
        onSubmit={report}
      />
    </div>
  );
}
