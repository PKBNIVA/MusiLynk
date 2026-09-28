import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { OpportunityPipeline, jobStatusLabel, toastJobError } from '../components/OpportunityPipeline';
import { toast } from 'sonner';
import { useAuth } from '../lib/authContext';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Inbox,
  ListChecks,
  PenLine,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import { HelpCallout } from '../components/help/HelpCallout';
import { FieldHelp } from '../components/help/FieldHelp';
import { StepForm, ReviewRow, focusStepHeading } from '../components/help/StepForm';
import { optionLabel } from '../components/ui/option-labels';
import { errorMessage, errorStatus } from '../lib/errors';
import type { CreatedJob, Job } from '../lib/apiTypes';
import { Field, FormError, RequiredNote } from '../components/form/Field';
import { useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { AppSelect } from '../components/ui/app-select';
import { AiSuggestButton } from '../components/ai/AiSuggestButton';
import { AutocompleteInput } from '../components/ai/AutocompleteInput';
import { AiCreditsBadge } from '../components/ai/AiCreditsBadge';
import { trackJobPosted } from '../lib/analytics';

/** ActorResolver::Actor#as_json — the identities a person can post an opportunity as. */
type Identity = { type: 'user' | 'organization' | 'act'; id: string; name: string; key: string };
// Which Page (if any) this job is posted as, for this session only: no shared "acting as" key
// exists yet elsewhere in the app (api.ts has none), so this is scoped to opportunity posting —
// coordinate with any later global switcher before reusing the key name.
const POSTED_AS_KEY = 'verse:post-job:posted-as';

type JobField =
  | 'title'
  | 'location'
  | 'description'
  | 'compensationMin'
  | 'compensationMax'
  | 'slots'
  | 'applicationDeadline'
  | 'screeningQuestions'
  | 'company';
const JOB_IDS: Partial<Record<JobField, string>> = {
  title: 'job-title',
  location: 'job-location',
  description: 'job-description',
  compensationMin: 'job-minimum',
  compensationMax: 'job-maximum',
  slots: 'job-open-slots',
  applicationDeadline: 'job-application-deadline',
  screeningQuestions: 'job-screening-questions',
};
/* Which wizard step owns each validated field: Next checks only the step being left. */
const STEP_IDS = ['basics', 'details', 'pay', 'review'] as const;
const FIELD_STEP: Record<JobField, number> = {
  title: 0,
  company: 0,
  location: 0,
  description: 1,
  compensationMin: 2,
  compensationMax: 2,
  slots: 2,
  applicationDeadline: 2,
  screeningQuestions: 3,
};
const SCREENING_PLACEHOLDER = [
  'Can you sight-read charts?',
  'Which console / DAW do you use most?',
  'Are you available for all tour dates?',
].join('\n');
const kinds = ['job', 'gig', 'audition', 'session', 'tour', 'internship', 'collaboration'];
const functions = [
  'Performance',
  'Composition & Songwriting',
  'Music Production',
  'Recording & Studio',
  'Live Sound & Audio',
  'Stage & Technical',
  'Tour & Production Management',
  'Lighting & Video',
  'A&R & Label',
  'Artist Management',
  'Booking & Events',
  'Publishing / Rights / Royalties',
  'Marketing / PR / Content',
  'Music Education',
  'Music Tech',
];
const blank = {
  title: '',
  company: '',
  location: '',
  type: 'Contract',
  genre: 'Multi-genre',
  opportunityKind: 'job',
  functionArea: 'Performance',
  workplace: 'onsite',
  salary: '',
  compensationMin: '',
  compensationMax: '',
  currency: 'INR',
  compensationPeriod: 'project',
  paid: true,
  description: '',
  requirements: '',
  skills: '',
  languages: '',
  experienceLevel: 'intermediate',
  portfolioRequired: false,
  slots: 1,
  applicationDeadline: '',
  startDate: '',
  duration: '',
  screeningQuestions: '',
};
// Inputs hand back strings, so `slots` holds whatever was typed until it is submitted.
type JobForm = Omit<typeof blank, 'slots'> & { slots: number | string };
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
// API job (snake_case columns + a few camelCase aliases) -> form state.
const toForm = (j: Job): JobForm => ({
  ...blank,
  title: text(j.title),
  location: text(j.location),
  type: j.type || j.kind || blank.type,
  genre: j.genre || blank.genre,
  opportunityKind: j.opportunity_kind || blank.opportunityKind,
  functionArea: j.function_area || blank.functionArea,
  workplace: j.workplace || blank.workplace,
  salary: text(j.salary),
  compensationMin: text(j.compensation_min),
  compensationMax: text(j.compensation_max),
  currency: j.currency || blank.currency,
  compensationPeriod: text(j.compensation_period),
  paid: j.paid !== false,
  description: text(j.description),
  requirements: text(j.requirements),
  skills: (j.skills || []).join(', '),
  languages: (j.languages || []).join(', '),
  experienceLevel: j.experience_level || blank.experienceLevel,
  portfolioRequired: !!(j.portfolioRequired ?? j.portfolio_required),
  slots: j.slots ?? 1,
  applicationDeadline: day(j.application_deadline),
  startDate: day(j.start_date),
  duration: text(j.duration),
  screeningQuestions: (j.screeningQuestions || j.screening_questions || []).join('\n'),
});
const list = (v: string) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const lines = (v: string) =>
  String(v || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
export default function PostJob() {
  const nav = useNavigate(),
    { user } = useAuth(),
    [sp, setSp] = useSearchParams();
  const seeker = user?.role === 'jobseeker';
  const editId = sp.get('edit') || '';
  const [f, setF] = useState<JobForm>(blank);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const last = STEP_IDS.length - 1;
  const form = useFormErrors<JobField>({ ids: JOB_IDS });
  const saveOnce = useSubmitOnce();
  const busy = saveOnce.busy;
  const [job, setJob] = useState<Job | null>(null),
    [loadingJob, setLoadingJob] = useState(!!editId),
    [loadError, setLoadError] = useState(''),
    [pipelineKey, setPipelineKey] = useState(0);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [postedAs, setPostedAs] = useState(''); // '' = personal; else "organization:<id>" / "act:<id>"
  const { setFormError, clear: clearErrors } = form;
  const set = <K extends keyof JobForm>(k: K, v: JobForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    form.clear(k as JobField);
  };
  const userId = user?.id;
  useEffect(() => {
    apiGet<{ identities?: Identity[] }>('/me/identities')
      .then((d) => setIdentities((d.identities || []).filter((i) => i.type !== 'user')))
      .catch(() => setIdentities([]));
  }, []);
  useEffect(() => {
    clearErrors();
    if (!editId) {
      setJob(null);
      setLoadError('');
      setLoadingJob(false);
      let saved = '';
      try {
        saved = localStorage.getItem(POSTED_AS_KEY) || '';
      } catch {
        /* best effort only */
      }
      setPostedAs(saved);
      return;
    }
    setLoadingJob(true);
    setLoadError('');
    apiGet<{ job?: Job }>(`/jobs/${encodeURIComponent(editId)}`)
      .then((d) => {
        if (!d.job || (userId && d.job.employer_id && d.job.employer_id !== userId))
          throw new Error('Opportunity not found');
        setJob(d.job);
        setF(toForm(d.job));
        setPostedAs(d.job.postedAs ? `${d.job.postedAs.type}:${d.job.postedAs.id}` : '');
        setReached(STEP_IDS.length - 1);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'This opportunity could not be loaded.')))
      .finally(() => setLoadingJob(false));
  }, [editId, userId, clearErrors]);
  function choosePostedAs(key: string) {
    setPostedAs(key);
    if (!job) {
      try {
        localStorage.setItem(POSTED_AS_KEY, key);
      } catch {
        /* best effort only */
      }
    }
  }
  const postedAsLabel = postedAs ? identities.find((i) => i.key === postedAs)?.name || postedAs : 'You, personally';
  const status = job?.status as string | undefined;
  const primary =
    !job || status === 'draft'
      ? { label: 'Submit for review', status: 'pending' }
      : status === 'pending'
        ? { label: 'Save changes', status: undefined }
        : status === 'published'
          ? { label: 'Save & resubmit for review', status: undefined }
          : status === 'rejected'
            ? { label: 'Resubmit for review', status: 'pending' }
            : { label: 'Reopen & submit for review', status: 'pending' };
  const canDraft = !job || ['draft', 'rejected', 'closed', 'pending'].includes(status || '');
  function payload() {
    return {
      ...f,
      company: f.company || undefined,
      skills: list(f.skills),
      languages: list(f.languages),
      screeningQuestions: lines(f.screeningQuestions),
      // Create resolves the actor from `actingAs` (or defaults to personal); update only re-attaches
      // when `postedAs` is sent explicitly, so both are always included to reflect this step's choice.
      ...(job ? { postedAs: postedAs || null } : postedAs ? { actingAs: postedAs } : {}),
    };
  }
  // Every problem at once, per field (the API applies the same rules: Job model + submission_error).
  function check(draft: boolean) {
    const errors: Partial<Record<JobField, string>> = {};
    if (f.title.trim().length < 3) errors.title = 'Add a title of at least 3 characters.';
    const questions = lines(f.screeningQuestions);
    if (questions.length > 8) errors.screeningQuestions = 'Use at most 8 screening questions.';
    else if (questions.some((q) => q.length >= 300))
      errors.screeningQuestions = 'Keep each screening question under 300 characters.';
    if (draft) return errors;
    if (!f.location.trim()) errors.location = 'Add where the work happens (a city, or "Remote").';
    if (f.description.trim().length < 60)
      errors.description = `Describe the work in at least 60 characters (${f.description.trim().length} so far).`;
    if (f.compensationMin !== '' && Number(f.compensationMin) < 0) errors.compensationMin = 'Pay cannot be negative.';
    if (f.compensationMin !== '' && f.compensationMax !== '' && Number(f.compensationMin) > Number(f.compensationMax))
      errors.compensationMax = 'Maximum pay must be at least the minimum.';
    if (!(Number(f.slots) >= 1)) errors.slots = 'Open slots must be at least 1.';
    if (f.applicationDeadline && f.applicationDeadline < new Date().toISOString().slice(0, 10))
      errors.applicationDeadline = 'The application deadline must be in the future.';
    return errors;
  }
  function goTo(index: number) {
    flushSync(() => {
      setStep(index);
      setReached((r) => Math.max(r, index));
    });
    focusStepHeading(STEP_IDS[index]);
  }
  /** Shows the earliest step that has an error, then focuses its first invalid field. */
  function showErrors(errors: Partial<Record<JobField, string>>) {
    const steps = (Object.keys(errors) as JobField[]).filter((k) => errors[k]).map((k) => FIELD_STEP[k] ?? 0);
    if (steps.length) flushSync(() => setStep(Math.min(...steps)));
    form.focusFirst();
  }
  function next() {
    const all = check(false);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => FIELD_STEP[k as JobField] === step)) as Partial<
      Record<JobField, string>
    >;
    if (form.setErrors(mine)) {
      form.focusFirst();
      return;
    }
    goTo(Math.min(step + 1, last));
  }
  function done() {
    if (seeker) {
      setStep(0);
      setReached(0);
      setF(blank);
      setJob(null);
      setPipelineKey((k) => k + 1);
      if (editId) setSp({}, { replace: true });
      window.scrollTo({ top: 0 });
    } else nav('/employer');
  }
  function submit(e: React.FormEvent | React.MouseEvent, mode: 'primary' | 'draft' = 'primary') {
    e.preventDefault();
    // Enter in a field on an early step moves on instead of submitting half a listing.
    if (mode === 'primary' && step < last) {
      next();
      return;
    }
    void saveOnce.run(() => persist(mode === 'draft'));
  }
  async function persist(draft: boolean) {
    setFormError('');
    const errors = check(draft);
    if (form.setErrors(errors)) {
      showErrors(errors);
      return;
    }
    try {
      if (job) {
        const target = draft ? 'draft' : primary.status;
        const d = await apiPatch<{ ok: boolean; job?: Job }>(`/employer/jobs/${job.id}`, {
          ...payload(),
          ...((target && target !== job.status) || target === 'pending' ? { status: target } : {}),
        });
        const next = d.job?.status;
        toast.success(
          next === 'draft' ? 'Draft saved' : next === 'pending' ? 'Saved and submitted for review' : 'Changes saved',
        );
        done();
      } else {
        const d = await apiPost<CreatedJob>('/jobs', { ...payload(), status: draft ? 'draft' : 'pending' });
        if (!draft) trackJobPosted();
        if (d.moderationFlags?.length && !draft)
          toast.info(
            `Submitted with ${d.moderationFlags.length} moderation note${d.moderationFlags.length === 1 ? '' : 's'}`,
          );
        else toast.success(draft ? 'Draft saved. Finish it any time from your opportunities.' : 'Submitted for review');
        done();
      }
    } catch (e: unknown) {
      const billing = seeker ? '/jobseeker/billing' : '/employer/billing';
      if (errorStatus(e) === 402 && !draft) {
        /* Keep the work: save it as a draft so publishing can resume after an upgrade or closing another post. */ try {
          if (job) await apiPatch(`/employer/jobs/${job.id}`, { ...payload(), status: 'draft' });
          else await apiPost('/jobs', { ...payload(), status: 'draft' });
          toast.warning(`${errorMessage(e)} Your opportunity was saved as a draft.`, {
            action: { label: 'View plans', onClick: () => nav(billing) },
          });
          done();
          return;
        } catch {}
      }
      // Plan limits keep their "View plans" toast; everything else is shown next to its field.
      if (errorStatus(e) === 402) toastJobError(e, billing, nav);
      if (form.setFromApi(e, 'This opportunity could not be saved. Try again.')) {
        // Render the server's field errors, then open the step holding the first one.
        flushSync(() => {});
        const owner = document
          .querySelector<HTMLElement>('[data-step] [aria-invalid="true"]')
          ?.closest<HTMLElement>('[data-step]');
        const index = STEP_IDS.indexOf(owner?.dataset.step as (typeof STEP_IDS)[number]);
        if (index >= 0) flushSync(() => setStep(index));
        form.focusFirst();
      }
    }
  }
  const backTo = seeker ? '/jobseeker/hiring/post' : '/employer';
  if (editId && (loadingJob || loadError || job?.id !== editId))
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navigation />
        <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
          {loadError ? (
            <Card className="bg-white/[.055] border-white/10">
              <CardContent className="p-8 text-center" role="alert">
                <p className="text-rose-300">{loadError}</p>
                <Button className="mt-4" variant="outline" asChild>
                  <Link to={backTo}>Back to your opportunities</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p role="status" className="text-slate-400">
              Loading opportunity…
            </p>
          )}
        </main>
      </div>
    );
  const input = 'bg-black/20 border-white/15';
  const payText =
    f.compensationMin || f.compensationMax
      ? `${f.currency} ${[f.compensationMin, f.compensationMax].filter(Boolean).join('–')}${f.compensationPeriod ? ` per ${f.compensationPeriod}` : ''}`
      : f.paid
        ? 'Paid · amount on request'
        : 'Unpaid';
  const questions = lines(f.screeningQuestions);
  // Shared context for job_description / job_screening_questions: only the fields the task
  // allow-lists, built fresh whenever a suggestion is requested.
  const jobAiContext = () => ({
    title: f.title,
    type: f.type,
    function: f.functionArea,
    city: f.location,
    pay: payText,
    keyPoints: list(f.skills),
  });
  const steps = [
    {
      id: STEP_IDS[0],
      title: 'Basics',
      icon: PenLine,
      description: 'What the opportunity is and where it happens.',
      content: (
        <div className="grid md:grid-cols-2 gap-5">
          <RequiredNote className="md:col-span-2 -mt-2" />
          <Field
            id="job-title"
            label="Title"
            required
            className="md:col-span-2"
            error={form.errors.title}
            hint="Lead with the role and the project, e.g. “Session drummer for an indie rock album”."
          >
            <Input
              maxLength={160}
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Session vocalist for Hindi indie EP"
              className={input}
            />
          </Field>
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-opportunity-type">Opportunity type</Label>
              <FieldHelp topic="Opportunity type">
                The format of the work. Pick “Gig” for a single paid show, “Studio session” for recording work and “Job”
                for an ongoing role.
              </FieldHelp>
            </div>
            <AppSelect
              id="job-opportunity-type"
              value={f.opportunityKind}
              onValueChange={(v) => set('opportunityKind', v)}
              className="mt-2"
              options={kinds}
            />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-function">Function</Label>
              <FieldHelp topic="Function">
                The area of music work this sits in. Professionals filter search by function, so choose the closest
                match.
              </FieldHelp>
            </div>
            <AppSelect
              id="job-function"
              value={f.functionArea}
              onValueChange={(v) => set('functionArea', v)}
              className="mt-2"
              options={functions}
            />
          </div>
          <div>
            <AutocompleteInput
              id="job-location"
              field="cities"
              label="Location (required)"
              multiple={false}
              values={f.location ? [f.location] : []}
              onChange={(vs) => set('location', vs[0] || '')}
              placeholder="Mumbai, Maharashtra"
            />
            {form.errors.location && (
              <p role="alert" className="mt-1.5 text-sm text-rose-300">
                {form.errors.location}
              </p>
            )}
          </div>
          {identities.length > 0 && (
            <div>
              <div className="flex items-center gap-1">
                <Label htmlFor="job-posted-as">Posting as</Label>
                <FieldHelp topic="Posting as">
                  Post this opportunity as yourself, or as a studio, label or act you run. It shows the Page's name
                  instead of yours and appears on that Page's public listings.
                </FieldHelp>
              </div>
              <AppSelect
                id="job-posted-as"
                value={postedAs}
                onValueChange={choosePostedAs}
                className="mt-2"
                options={[
                  { value: '', label: 'You, personally' },
                  ...identities.map((i) => ({ value: i.key, label: i.name })),
                ]}
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-workplace">Workplace</Label>
              <FieldHelp topic="Workplace">
                Where the work is done: at a venue or studio (on-site), from home (remote), a mix (hybrid) or on the
                road (travel).
              </FieldHelp>
            </div>
            <AppSelect
              id="job-workplace"
              value={f.workplace}
              onValueChange={(v) => set('workplace', v)}
              className="mt-2"
              options={['onsite', 'hybrid', 'remote', 'travel']}
            />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-engagement">Engagement</Label>
              <FieldHelp topic="Engagement">
                How the person is hired. Most gigs and sessions are “Freelance” or “Project-based”.
              </FieldHelp>
            </div>
            <AppSelect
              id="job-engagement"
              value={f.type}
              onValueChange={(v) => set('type', v)}
              className="mt-2"
              options={['Full-time', 'Part-time', 'Contract', 'Freelance', 'Project-based']}
            />
          </div>
          <div>
            <Label htmlFor="job-genre-repertoire">Genre / repertoire</Label>
            <Input
              id="job-genre-repertoire"
              value={f.genre}
              onChange={(e) => set('genre', e.target.value)}
              className={`mt-2 ${input}`}
            />
          </div>
        </div>
      ),
    },
    {
      id: STEP_IDS[1],
      title: 'Details',
      icon: FileText,
      description: 'What the person will actually do, and what they need to bring.',
      content: (
        <div className="space-y-5">
          <Field
            id="job-description"
            label="Description"
            labelExtra={
              <>
                <AiSuggestButton
                  task="job_description"
                  label="Write with AI"
                  getContext={jobAiContext}
                  onAccept={(text) => set('description', text)}
                />
                {f.description.trim() && (
                  <AiSuggestButton
                    task="improve_text"
                    label="Improve"
                    value={f.description}
                    getContext={() => ({ tone: 'clearer', text: f.description })}
                    onAccept={(text) => set('description', text)}
                  />
                )}
              </>
            }
            required
            hint="At least 60 characters."
            help="Cover the scope, the dates or schedule, who they will work with and what a great result looks like. Specific listings get better applicants."
            error={form.errors.description}
          >
            <Textarea
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Scope, deliverables, collaborators, expected schedule, reporting line and what success looks like…"
              className={`${input} min-h-44`}
            />
          </Field>
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-requirements">Requirements</Label>
              <FieldHelp topic="Requirements">
                Split must-haves from nice-to-haves. Concrete skills (“reads charts”, “owns in-ear monitors”) beat vague
                ones.
              </FieldHelp>
            </div>
            <Textarea
              id="job-requirements"
              value={f.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              placeholder="Must-haves vs nice-to-haves. Avoid vague 'rockstar' criteria."
              className={`mt-2 ${input}`}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <AutocompleteInput
                id="job-skills"
                field="skills"
                label="Skills"
                values={list(f.skills)}
                onChange={(vs) => set('skills', vs.join(', '))}
                placeholder="Pro Tools, vocal comping, Hindi diction"
              />
            </div>
            <div>
              <Label htmlFor="job-languages">
                Languages <span className="text-slate-500">(optional)</span>
              </Label>
              <Input
                id="job-languages"
                value={f.languages}
                onChange={(e) => set('languages', e.target.value)}
                placeholder="Hindi, English"
                className={`mt-2 ${input}`}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: STEP_IDS[2],
      title: 'Pay & dates',
      icon: Wallet,
      description: 'Clear pay and timing is the biggest reason people apply.',
      content: (
        <div className="grid md:grid-cols-3 gap-5">
          <label className="flex items-center gap-2 md:col-span-3">
            <Checkbox checked={f.paid} onCheckedChange={(v) => set('paid', !!v)} />
            <span className="text-sm">This is a paid opportunity</span>
          </label>
          <Field
            id="job-minimum"
            label="Minimum pay"
            error={form.errors.compensationMin}
            help="The lowest you would pay for the whole engagement or per period. A range gets up to twice as many serious applicants as “negotiable”."
          >
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              value={f.compensationMin}
              onChange={(e) => set('compensationMin', e.target.value)}
              className={input}
            />
          </Field>
          <Field
            id="job-maximum"
            label="Maximum pay"
            error={form.errors.compensationMax}
            help="The top of your range. Leave it blank if the pay is a fixed amount."
          >
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              value={f.compensationMax}
              onChange={(e) => set('compensationMax', e.target.value)}
              className={input}
            />
          </Field>
          <div>
            <Label htmlFor="job-currency">Currency</Label>
            <AppSelect
              id="job-currency"
              value={f.currency}
              onValueChange={(v) => set('currency', v)}
              className="mt-2"
              options={['INR', 'USD', 'EUR', 'GBP']}
            />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="job-pay-period">Pay period</Label>
              <FieldHelp topic="Pay period">
                What the amount covers: the whole project, one show, a day, or a month.
              </FieldHelp>
            </div>
            <Input
              id="job-pay-period"
              value={f.compensationPeriod}
              onChange={(e) => set('compensationPeriod', e.target.value)}
              placeholder="project / show / month"
              className={`mt-2 ${input}`}
            />
          </div>
          <Field
            id="job-application-deadline"
            label="Application deadline"
            error={form.errors.applicationDeadline}
            help="The listing closes to new applicants after this day. Leave it blank to keep it open until you close it."
          >
            <Input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={f.applicationDeadline}
              onChange={(e) => set('applicationDeadline', e.target.value)}
              className={input}
            />
          </Field>
          <div>
            <Label htmlFor="job-start-date">Start date</Label>
            <Input
              id="job-start-date"
              type="date"
              value={f.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className={`mt-2 ${input}`}
            />
          </div>
          <div>
            <Label htmlFor="job-duration">Duration</Label>
            <Input
              id="job-duration"
              value={f.duration}
              onChange={(e) => set('duration', e.target.value)}
              placeholder="3 sessions / 6 weeks / ongoing"
              className={`mt-2 ${input}`}
            />
          </div>
          <Field
            id="job-open-slots"
            label="Open slots"
            required
            error={form.errors.slots}
            help="How many people you want to hire for this. A horn section of three is 3 slots."
          >
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              value={f.slots}
              onChange={(e) => set('slots', e.target.value)}
              className={input}
            />
          </Field>
        </div>
      ),
    },
    {
      id: STEP_IDS[3],
      title: 'Screening & review',
      icon: ClipboardCheck,
      description: 'Add optional questions, then check everything before it goes to review.',
      content: (
        <div className="space-y-6">
          <Field
            id="job-screening-questions"
            label="Screening questions"
            labelExtra={
              <AiSuggestButton
                task="job_screening_questions"
                label="Suggest questions"
                getContext={jobAiContext}
                onAccept={(text) => set('screeningQuestions', text)}
              />
            }
            optional
            hint="One per line, up to 8. Applicants must answer each one."
            help="Short questions every applicant answers, like “Can you sight-read charts?”. They help you shortlist quickly. Keep them to what really matters."
            error={form.errors.screeningQuestions}
          >
            <Textarea
              value={f.screeningQuestions}
              onChange={(e) => set('screeningQuestions', e.target.value)}
              placeholder={SCREENING_PLACEHOLDER}
              className={`${input} min-h-28`}
            />
          </Field>
          <label className="flex gap-2 items-center">
            <Checkbox checked={f.portfolioRequired} onCheckedChange={(v) => set('portfolioRequired', !!v)} />
            <span className="text-sm">Require a portfolio / work sample</span>
          </label>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <ListChecks aria-hidden="true" size={20} className="text-violet-300" />
              Review your listing
            </h3>
            <dl>
              <ReviewRow label="Title" value={f.title} onEdit={() => goTo(0)} />
              {identities.length > 0 && <ReviewRow label="Posted as" value={postedAsLabel} onEdit={() => goTo(0)} />}
              <ReviewRow
                label="Format"
                value={[optionLabel(f.opportunityKind), f.functionArea, f.type].join(' · ')}
                onEdit={() => goTo(0)}
              />
              <ReviewRow
                label="Where"
                value={[f.location, optionLabel(f.workplace)].filter(Boolean).join(' · ')}
                onEdit={() => goTo(0)}
              />
              <ReviewRow
                label="Description"
                value={
                  f.description ? `${f.description.trim().slice(0, 140)}${f.description.length > 140 ? '…' : ''}` : ''
                }
                onEdit={() => goTo(1)}
              />
              <ReviewRow label="Pay" value={payText} onEdit={() => goTo(2)} />
              <ReviewRow
                label="Dates"
                value={[
                  f.applicationDeadline && `Apply by ${f.applicationDeadline}`,
                  f.startDate && `starts ${f.startDate}`,
                  f.duration,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onEdit={() => goTo(2)}
              />
              <ReviewRow
                label="Screening"
                value={`${questions.length ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : 'No questions'}${f.portfolioRequired ? ' · work sample required' : ''}`}
              />
            </dl>
          </div>
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[.06] p-4 flex gap-3 text-sm text-emerald-100">
            <ShieldCheck aria-hidden="true" className="shrink-0" size={20} />
            <p>
              Listings are reviewed for clarity, trust and suspicious off-platform fee/contact language. Verified
              employers receive a trust marker, but verification never replaces candidate due diligence.
            </p>
          </div>
        </div>
      ),
    },
  ];
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">
              {job ? `Edit opportunity · ${jobStatusLabel[job.status] || job.status}` : 'Create opportunity'}
            </div>
            <h1 className="text-4xl font-bold">
              {job ? job.title || 'Untitled opportunity' : 'Describe the work, not just the title'}
            </h1>
            <p className="text-slate-400 mt-2 max-w-3xl">
              Four short steps. Clear format, pay and dates bring better applicants and fewer back-and-forth messages.
            </p>
          </div>
          <AiCreditsBadge />
        </div>
        {!job && (
          <HelpCallout
            id="post-job"
            title="How posting works"
            steps={[
              { icon: PenLine, title: 'Describe the work', text: 'Four quick steps. Save a draft at any point.' },
              {
                icon: BadgeCheck,
                title: 'We review it',
                text: 'Our team checks every listing for clarity and safety before it goes live.',
              },
              {
                icon: Inbox,
                title: 'Applicants arrive',
                text: 'Answers, samples and messages land in Applications, ready to shortlist.',
              },
            ]}
          />
        )}
        {job?.status === 'published' && (
          <div
            role="note"
            className="mb-5 rounded-xl border border-sky-400/20 bg-sky-500/[.07] p-4 text-sm text-sky-100"
          >
            This opportunity is live. Saving changes sends it back to review; it reappears in search once approved.
          </div>
        )}
        {job?.status === 'rejected' && job.moderation_note && (
          <div
            role="note"
            className="mb-5 rounded-xl border border-amber-400/20 bg-amber-500/[.07] p-4 text-sm text-amber-100"
          >
            Review note: {job.moderation_note}
          </div>
        )}
        {seeker && !job && (
          <section className="mb-8" aria-labelledby="my-opportunities">
            <h2 id="my-opportunities" className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Sparkles aria-hidden="true" size={24} className="text-violet-300" />
              Your opportunities
            </h2>
            <OpportunityPipeline
              role="jobseeker"
              reloadKey={pipelineKey}
              emptyHint="Opportunities and drafts you create appear here."
            />
          </section>
        )}
        <form onSubmit={(e) => submit(e)} className="verse-surface rounded-3xl p-5 md:p-8" noValidate>
          <StepForm steps={steps} current={step} reached={reached} onStepChange={goTo} />
          <FormError message={form.formError} className="mt-5" />
          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
            {step > 0 ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => goTo(step - 1)}>
                <ArrowLeft aria-hidden="true" size={16} className="mr-2" />
                Back
              </Button>
            ) : job ? (
              <Button type="button" variant="ghost" disabled={busy} asChild>
                <Link to={backTo}>Cancel</Link>
              </Button>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:ml-auto sm:flex-row">
              {canDraft && (
                <Button disabled={busy} type="button" variant="outline" onClick={(e) => submit(e, 'draft')}>
                  {job && job.status !== 'draft' ? 'Move to drafts' : 'Save draft'}
                </Button>
              )}
              {step < last ? (
                <Button key="next" type="button" onClick={next} className="min-w-36">
                  Next: {steps[step + 1].title}
                  <ArrowRight aria-hidden="true" size={16} className="ml-2" />
                </Button>
              ) : (
                <Button key="submit" disabled={busy} aria-busy={busy} type="submit" className="min-w-44">
                  <Send aria-hidden="true" size={16} className="mr-2" />
                  {busy ? 'Saving…' : primary.label}
                </Button>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
