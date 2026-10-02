import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
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
import { MoreDetails } from '../components/help/MoreDetails';
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
import {
  JobPostTemplates,
  PlaceholderNotice,
  findPlaceholders,
  hasPlaceholder,
  type JobPostTemplate,
} from '../components/templates/JobPostTemplates';
import { trackJobPosted } from '../lib/analytics';
import { formatDate, formatPay, formatInputEcho } from '../lib/format';
import { SubmittedListing } from '../components/SubmittedListing';
import { PostJobPlanLimitDialog } from '../components/PostJobPlanLimitDialog';

/** ActorResolver::Actor#as_json — the identities a person can post an opportunity as. */
type Identity = { type: 'user' | 'organization' | 'act'; id: string; name: string; key: string };
/** GET /jobs/limits: the plan's room for active opportunities. */
type JobLimits = { activeAllowed: number; activeUsed: number; plan?: string; planName?: string };
// Which Page (if any) this job is posted as, for this session only: no shared "acting as" key
// exists yet elsewhere in the app (api.ts has none), so this is scoped to opportunity posting —
// coordinate with any later global switcher before reusing the key name.
const POSTED_AS_KEY = 'verse:post-job:posted-as';
// A draft with no amount cannot say whether the pay is "Not disclosed" or simply not asked yet,
// so the explicit choice is remembered on this device, per draft.
const payModeKey = (id: string | number) => `verse:post-job:pay-mode:${id}`;
function rememberedPayMode(id: string | number | undefined): PayMode | null {
  if (!id) return null;
  try {
    const v = localStorage.getItem(payModeKey(id));
    return v === 'undisclosed' ? v : null;
  } catch {
    return null;
  }
}

type JobField =
  | 'title'
  | 'location'
  | 'description'
  | 'requirements'
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
  requirements: 'job-requirements',
  compensationMin: 'job-minimum',
  compensationMax: 'job-maximum',
  slots: 'job-open-slots',
  applicationDeadline: 'job-application-deadline',
  screeningQuestions: 'job-screening-questions',
};
/* Which wizard step owns each validated field: Next checks only the step being left. */
const STEP_IDS = ['what', 'pay', 'review'] as const;
const FIELD_STEP: Record<JobField, number> = {
  title: 0,
  company: 0,
  location: 0,
  compensationMin: 1,
  compensationMax: 1,
  slots: 1,
  applicationDeadline: 1,
  description: 2,
  requirements: 2,
  screeningQuestions: 2,
};
/* The fields a {{placeholder}} can be left in, with the step each lives on. */
const PLACEHOLDER_FIELDS = [
  { id: 'job-title', step: 0 },
  { id: 'job-description', step: 2 },
  { id: 'job-requirements', step: 2 },
  { id: 'job-screening-questions', step: 2 },
] as const;
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
const PAY_PERIODS = ['project', 'show', 'day', 'hour', 'week', 'month'];
/** How the pay is presented: an amount, "Not disclosed", or no pay at all. */
type PayMode = 'range' | 'undisclosed' | 'unpaid';
const PAY_MODES: { value: PayMode; label: string }[] = [
  { value: 'range', label: 'Show the pay' },
  { value: 'undisclosed', label: 'Not disclosed' },
  { value: 'unpaid', label: 'Unpaid' },
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
  payMode: 'range' as PayMode,
  compensationMin: '',
  compensationMax: '',
  currency: 'INR',
  compensationPeriod: 'project',
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
const toForm = (j: Job): JobForm => {
  const hasAmount = j.compensation_min != null || j.compensation_max != null;
  return {
    ...blank,
    title: text(j.title),
    location: text(j.location),
    type: j.type || j.kind || blank.type,
    genre: j.genre || blank.genre,
    opportunityKind: j.opportunity_kind || blank.opportunityKind,
    functionArea: j.function_area || blank.functionArea,
    workplace: j.workplace || blank.workplace,
    salary: text(j.salary),
    // A draft that has not reached the pay step yet has no amount because none was asked for.
    payMode:
      j.paid === false
        ? 'unpaid'
        : hasAmount
          ? 'range'
          : j.status === 'draft'
            ? (rememberedPayMode(j.id) ?? 'range')
            : 'undisclosed',
    compensationMin: text(j.compensation_min),
    compensationMax: text(j.compensation_max),
    currency: j.currency || blank.currency,
    compensationPeriod: text(j.compensation_period),
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
  };
};
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
const PLACEHOLDER_MESSAGE = 'Fill in each highlighted spot with real details.';
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
  // The plan's room for active opportunities, shown above the form before anything is typed (J-01).
  const [limits, setLimits] = useState<JobLimits | null>(null);
  // A draft from an earlier visit, offered when this page opens without ?edit= (J-13).
  const [offeredDraft, setOfferedDraft] = useState<Job | null>(null);
  // False until the draft lookup answers (or 1.5 s pass). The content under the header stays
  // invisible until then, so a banner arriving late does not push a visible form down the page.
  const [draftChecked, setDraftChecked] = useState(!!editId);
  // The draft this visit has been saving on every step change ('' until the first save). The ref
  // is what the save logic reads, since a save can finish between two renders.
  const [draftId, setDraftId] = useState('');
  const draftRef = useRef('');
  // Set once an opportunity has been submitted for review: the page shows what happens next (J-12).
  const [submitted, setSubmitted] = useState<{ id: string; title: string } | null>(null);
  const [autosave, setAutosave] = useState<'' | 'saved' | 'failed'>('');
  const autosaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  // The 402 plan-limit dialog (V-14): non-null holds the server's verbatim message and keeps
  // the person on this page until they pick "See plans", "Close another listing" or "Keep as
  // draft" — the draft itself was already saved by the time this opens.
  const [planLimitMessage, setPlanLimitMessage] = useState<string | null>(null);
  const { setFormError, clear: clearErrors } = form;
  const set = <K extends keyof JobForm>(k: K, v: JobForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    form.clear(k as JobField);
  };
  const userId = user?.id;
  const profileCity = user?.location?.trim() || '';
  const profileCompany = user?.companyName?.trim() || '';
  useEffect(() => {
    apiGet<{ identities?: Identity[] }>('/me/identities')
      .then((d) => setIdentities((d.identities || []).filter((i) => i.type !== 'user')))
      .catch(() => setIdentities([]));
  }, []);
  useEffect(() => {
    apiGet<Partial<JobLimits>>('/jobs/limits')
      .then((d) =>
        setLimits(typeof d.activeAllowed === 'number' && typeof d.activeUsed === 'number' ? (d as JobLimits) : null),
      )
      .catch(() => setLimits(null));
  }, [pipelineKey]);
  useEffect(() => {
    clearErrors();
    if (!editId) {
      setJob(null);
      setLoadError('');
      setLoadingJob(false);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(POSTED_AS_KEY);
      } catch {
        /* best effort only */
      }
      setPostedAs(saved || '');
      apiGet<{ jobs?: Job[] }>('/employer/jobs')
        .then((d) => setOfferedDraft((d.jobs || []).find((j) => j.status === 'draft') || null))
        .catch(() => setOfferedDraft(null))
        .finally(() => setDraftChecked(true));
      const reveal = setTimeout(() => setDraftChecked(true), 1500);
      return () => clearTimeout(reveal);
    }
    setOfferedDraft(null);
    setDraftChecked(true);
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
  // A fresh listing starts from what onboarding already told us: the city from the profile, and
  // the Page made from the company name (unless a choice was remembered on this device).
  useEffect(() => {
    if (editId || !profileCity) return;
    setF((x) => (x.location ? x : { ...x, location: profileCity }));
  }, [editId, profileCity]);
  useEffect(() => {
    if (editId || !identities.length) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(POSTED_AS_KEY);
    } catch {
      /* best effort only */
    }
    if (remembered !== null) return;
    const pages = identities.filter((i) => i.type === 'organization');
    const named = pages.find((i) => profileCompany && i.name.trim().toLowerCase() === profileCompany.toLowerCase());
    if (named) setPostedAs((current) => current || named.key);
  }, [editId, identities, profileCompany]);
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
  // Whether text a moderator reads has changed on a live listing: only that sends it back to review.
  const reviewEdited =
    status === 'published' &&
    (f.title.trim() !== text(job?.title).trim() ||
      f.description.trim() !== text(job?.description).trim() ||
      f.requirements.trim() !== text(job?.requirements).trim());
  const primary =
    !job || status === 'draft'
      ? { label: 'Submit for review', status: 'pending' }
      : status === 'pending'
        ? { label: 'Save changes', status: undefined }
        : status === 'published'
          ? { label: reviewEdited ? 'Save & resubmit for review' : 'Save changes', status: undefined }
          : status === 'rejected'
            ? { label: 'Resubmit for review', status: 'pending' }
            : { label: 'Reopen & submit for review', status: 'pending' };
  const canDraft = !job || ['draft', 'rejected', 'closed', 'pending'].includes(status || '');
  // Only a submission that would add one more active opportunity is held back by the plan; the
  // rest of the form, and "Save draft", keep working.
  const atLimit = !!limits && limits.activeUsed >= limits.activeAllowed;
  const takesASlot = primary.status === 'pending' && status !== 'pending' && status !== 'published';
  const submitBlocked = atLimit && takesASlot;
  const billingPath = seeker ? '/jobseeker/billing' : '/employer/billing';
  // Create resolves the actor from `actingAs` (or defaults to personal); update only re-attaches
  // when `postedAs` is sent explicitly, so a saved job or draft always carries it to reflect this
  // step's choice.
  function payload(update: boolean, source: JobForm = f) {
    const { payMode, ...rest } = source;
    const shown = payMode === 'range';
    return {
      ...rest,
      company: source.company || undefined,
      paid: payMode !== 'unpaid',
      compensationMin: shown && source.compensationMin !== '' ? source.compensationMin : null,
      compensationMax: shown && source.compensationMax !== '' ? source.compensationMax : null,
      compensationPeriod: shown ? source.compensationPeriod : '',
      skills: list(source.skills),
      languages: list(source.languages),
      screeningQuestions: lines(source.screeningQuestions),
      ...(update ? { postedAs: postedAs || null } : postedAs ? { actingAs: postedAs } : {}),
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
    if (hasPlaceholder(f.title)) errors.title = PLACEHOLDER_MESSAGE;
    if (!errors.screeningQuestions && hasPlaceholder(f.screeningQuestions))
      errors.screeningQuestions = PLACEHOLDER_MESSAGE;
    if (hasPlaceholder(f.requirements)) errors.requirements = PLACEHOLDER_MESSAGE;
    if (!f.location.trim()) errors.location = 'Add where the work happens (a city, or "Remote").';
    if (hasPlaceholder(f.description)) errors.description = PLACEHOLDER_MESSAGE;
    else if (f.description.trim().length < 60)
      errors.description = `Describe the work in at least 60 characters (${f.description.trim().length} so far).`;
    if (f.payMode === 'range') {
      if (f.compensationMin !== '' && Number(f.compensationMin) < 0) errors.compensationMin = 'Pay cannot be negative.';
      if (f.compensationMin !== '' && f.compensationMax !== '' && Number(f.compensationMin) > Number(f.compensationMax))
        errors.compensationMax = 'Maximum pay must be at least the minimum.';
    }
    if (!(Number(f.slots) >= 1)) errors.slots = 'Open slots must be at least 1.';
    if (f.applicationDeadline && f.applicationDeadline < new Date().toISOString().slice(0, 10))
      errors.applicationDeadline = 'The application deadline must be in the future.';
    return errors;
  }
  // Saves the work so far as a draft. Runs on every step change for a new listing or an existing
  // draft, one save at a time so a fast Next never races the request before it; a listing that is
  // already pending or live is never touched until it is submitted.
  function saveDraftQuietly() {
    if (job && job.status !== 'draft') return;
    if (f.title.trim().length < 3 || check(true).screeningQuestions) return;
    const snapshot = { ...f };
    autosaveQueue.current = autosaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const existing = job?.id || draftRef.current;
        try {
          if (existing) {
            await apiPatch(`/employer/jobs/${existing}`, payload(true, snapshot), { skipPlanLimitEvent: true });
          } else {
            const d = await apiPost<CreatedJob>(
              '/jobs',
              { ...payload(false, snapshot), status: 'draft' },
              { skipPlanLimitEvent: true },
            );
            if (d?.id) {
              draftRef.current = d.id;
              setDraftId(d.id);
            }
          }
          const savedId = existing || draftRef.current;
          if (savedId) {
            try {
              if (snapshot.payMode === 'undisclosed') localStorage.setItem(payModeKey(savedId), 'undisclosed');
              else localStorage.removeItem(payModeKey(savedId));
            } catch {
              /* best effort only */
            }
          }
          setAutosave('saved');
        } catch {
          setAutosave('failed');
        }
      });
  }
  function goTo(index: number) {
    if (index !== step) saveDraftQuietly();
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
  // Back to an empty first step (and a fresh draft slot).
  function resetForm() {
    setStep(0);
    setReached(0);
    setF(blank);
    setJob(null);
    draftRef.current = '';
    setDraftId('');
    setAutosave('');
    setSubmitted(null);
    setPipelineKey((k) => k + 1);
    if (editId) setSp({}, { replace: true });
    window.scrollTo({ top: 0 });
  }
  function done() {
    if (seeker) resetForm();
    else nav('/employer');
  }
  // After a submission for review: show the "what happens next" card rather than leaving the page.
  function submittedForReview(id: string) {
    setSubmitted({ id, title: f.title.trim() });
    window.scrollTo({ top: 0 });
  }
  function submit(e: React.FormEvent | React.MouseEvent, mode: 'primary' | 'draft' = 'primary') {
    e.preventDefault();
    // Enter in a field on an early step moves on instead of submitting half a listing.
    if (mode === 'primary' && step < last) {
      next();
      return;
    }
    if (mode === 'primary' && submitBlocked) return;
    void saveOnce.run(async () => {
      await autosaveQueue.current.catch(() => undefined);
      await persist(mode === 'draft');
    });
  }
  async function persist(draft: boolean) {
    setFormError('');
    const errors = check(draft);
    if (form.setErrors(errors)) {
      showErrors(errors);
      return;
    }
    const existing = job?.id || draftRef.current;
    try {
      if (existing) {
        const target = draft ? 'draft' : job ? primary.status : 'pending';
        const currentStatus = job ? job.status : 'draft';
        const d = await apiPatch<{ ok: boolean; job?: Job }>(
          `/employer/jobs/${existing}`,
          {
            ...payload(true),
            ...((target && target !== currentStatus) || target === 'pending' ? { status: target } : {}),
          },
          // The dedicated plan-limit dialog below replaces the app-wide upgrade toast for this
          // call; skip its event so the two don't both fire on the same 402 (V-14).
          { skipPlanLimitEvent: true },
        );
        const next = d.job?.status;
        if (!job && next === 'pending') trackJobPosted();
        toast.success(
          next === 'draft' ? 'Draft saved' : next === 'pending' ? 'Saved and submitted for review' : 'Changes saved',
        );
        if (next === 'pending' && currentStatus !== 'pending') submittedForReview(existing);
        else done();
      } else {
        const d = await apiPost<CreatedJob>(
          '/jobs',
          { ...payload(false), status: draft ? 'draft' : 'pending' },
          { skipPlanLimitEvent: true },
        );
        if (!draft) trackJobPosted();
        if (d.moderationFlags?.length && !draft)
          toast.info(
            `Submitted with ${d.moderationFlags.length} moderation note${d.moderationFlags.length === 1 ? '' : 's'}`,
          );
        else toast.success(draft ? 'Draft saved. Finish it any time from your opportunities.' : 'Submitted for review');
        if (!draft && d.id) submittedForReview(d.id);
        else done();
      }
    } catch (e: unknown) {
      if (errorStatus(e) === 402 && !draft) {
        /* Keep the work: save it as a draft so publishing can resume after an upgrade or closing another post. */ try {
          if (existing)
            await apiPatch(
              `/employer/jobs/${existing}`,
              { ...payload(true), status: 'draft' },
              { skipPlanLimitEvent: true },
            );
          else await apiPost('/jobs', { ...payload(false), status: 'draft' }, { skipPlanLimitEvent: true });
          // A dialog, not a toast (V-14): stay on this page until the person picks a way
          // forward, since the draft is already safe.
          setPlanLimitMessage(errorMessage(e));
          return;
        } catch {}
      }
      // Plan limits keep their "View plans" toast; everything else is shown next to its field.
      if (errorStatus(e) === 402) toastJobError(e, billingPath, nav);
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
  const continueDraft = useCallback((id: string) => setSp({ edit: id }), [setSp]);
  if (submitted)
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navigation />
        <main className="max-w-3xl mx-auto px-4 sm:px-5 md:px-6 pt-28 pb-16">
          <SubmittedListing
            id={submitted.id}
            title={submitted.title}
            viewPath={`${seeker ? '/jobseeker' : '/employer'}/jobs/${encodeURIComponent(submitted.id)}`}
            dashboardPath={seeker ? '/jobseeker/hiring/post' : '/employer'}
            onAnother={resetForm}
          />
        </main>
      </div>
    );
  if (editId && (loadingJob || loadError || job?.id !== editId))
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navigation />
        <main className="max-w-5xl mx-auto px-4 sm:px-5 md:px-6 pt-28 pb-16">
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
    f.payMode === 'unpaid'
      ? 'Unpaid'
      : f.payMode === 'undisclosed'
        ? 'Not disclosed'
        : f.compensationMin || f.compensationMax
          ? `${formatPay({
              currency: f.currency,
              compensation_min: f.compensationMin,
              compensation_max: f.compensationMax,
            })}${f.compensationPeriod ? ` per ${f.compensationPeriod}` : ''}`
          : 'Paid · amount on request';
  const questions = lines(f.screeningQuestions);
  const placeholders = findPlaceholders(f.title, f.description, f.requirements, f.screeningQuestions);
  const showTemplates = !job || job.status === 'draft';
  // The warning belongs to the choice to hide the pay, not to the untouched default.
  const payHidden = f.payMode === 'undisclosed';
  const periods =
    !f.compensationPeriod || PAY_PERIODS.includes(f.compensationPeriod)
      ? PAY_PERIODS
      : [...PAY_PERIODS, f.compensationPeriod];
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
  // "Start from a template" — no network, no AI: prefills title, description skeleton and
  // screening questions for one of six common opportunity shapes. Only offered on a fresh draft.
  function applyTemplate(template: JobPostTemplate) {
    setF((x) => ({
      ...x,
      // Keep a title already typed on step 1; the template only fills an empty one.
      opportunityKind: x.title.trim() ? x.opportunityKind : template.opportunityKind,
      title: x.title.trim() ? x.title : template.title,
      description: template.description,
      screeningQuestions: template.screeningQuestions.join('\n'),
    }));
    form.clear('title');
    form.clear('description');
    form.clear('screeningQuestions');
  }
  // Selects the first field that still holds this placeholder, so it can be typed over.
  function selectPlaceholder(placeholder: string) {
    for (const { id, step: owner } of PLACEHOLDER_FIELDS) {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      const at = el ? el.value.indexOf(placeholder) : -1;
      if (!el || at < 0) continue;
      if (owner !== step) flushSync(() => setStep(owner));
      el.focus();
      el.setSelectionRange(at, at + placeholder.length);
      return;
    }
  }
  const steps = [
    {
      id: STEP_IDS[0],
      title: 'What & where',
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
                The area of music work this sits in. Musicians filter search by function, so choose the closest match.
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
              label="Location"
              required
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
                  instead of yours and appears on that Page's public opportunities.
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
          <MoreDetails className="md:col-span-2">
            <div className="grid md:grid-cols-2 gap-5">
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
          </MoreDetails>
        </div>
      ),
    },
    {
      id: STEP_IDS[1],
      title: 'Pay & dates',
      icon: Wallet,
      description: 'Clear pay and timing is the biggest reason people apply.',
      content: (
        <div className="grid md:grid-cols-3 gap-5">
          <fieldset className="md:col-span-3">
            <legend className="text-sm font-medium text-slate-300">Pay</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PAY_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/[.03] px-3.5 text-sm text-slate-100 hover:border-white/30 has-[:checked]:border-violet-300/70 has-[:checked]:bg-violet-500/20 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet-300"
                >
                  <input
                    type="radio"
                    name="job-pay-mode"
                    value={mode.value}
                    checked={f.payMode === mode.value}
                    onChange={() => {
                      set('payMode', mode.value);
                      form.clear('compensationMin');
                      form.clear('compensationMax');
                    }}
                    className="size-4 shrink-0 accent-violet-500 focus-visible:outline-none"
                  />
                  {mode.label}
                </label>
              ))}
            </div>
            {payHidden && (
              <p
                role="note"
                className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/[.08] p-3 text-sm text-amber-100"
              >
                Opportunities that don’t show the pay get fewer applicants. Add a range if you can; you can change it
                later.
              </p>
            )}
          </fieldset>
          {f.payMode === 'range' && (
            <>
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
                <div className="flex items-center gap-1">
                  <Label htmlFor="job-pay-period">Pay period</Label>
                  <FieldHelp topic="Pay period">
                    What the amount covers: the whole project, one show, a day, or a month.
                  </FieldHelp>
                </div>
                <AppSelect
                  id="job-pay-period"
                  value={f.compensationPeriod}
                  onValueChange={(v) => set('compensationPeriod', v)}
                  className="mt-2"
                  options={periods.map((period) => ({ value: period, label: `Per ${period}`, description: null }))}
                />
              </div>
            </>
          )}
          <Field
            id="job-application-deadline"
            label="Application deadline"
            hint={formatInputEcho(f.applicationDeadline)}
            error={form.errors.applicationDeadline}
            help="The opportunity closes to new applicants after this day. Leave it blank to keep it open until you close it."
          >
            <Input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={f.applicationDeadline}
              onChange={(e) => set('applicationDeadline', e.target.value)}
              className={input}
            />
          </Field>
          <MoreDetails className="md:col-span-3" forceOpen={!!form.errors.slots}>
            <div className="grid md:grid-cols-3 gap-5">
              <div>
                <Label htmlFor="job-start-date">Start date</Label>
                <Input
                  id="job-start-date"
                  type="date"
                  value={f.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                  className={`mt-2 ${input}`}
                />
                {f.startDate && <p className="mt-1 text-xs text-slate-400">{formatInputEcho(f.startDate)}</p>}
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
              {f.payMode === 'range' && (
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
              )}
            </div>
          </MoreDetails>
        </div>
      ),
    },
    {
      id: STEP_IDS[2],
      title: 'Screen & review',
      icon: ClipboardCheck,
      description: 'Describe the work, add optional questions, then check everything before it goes to review.',
      content: (
        <div className="space-y-6">
          {showTemplates && <JobPostTemplates onApply={applyTemplate} />}
          <PlaceholderNotice placeholders={placeholders} onSelect={selectPlaceholder} />
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
            help="Cover the scope, the dates or schedule, who they will work with and what a great result looks like. Specific opportunities get better applicants."
            error={form.errors.description}
          >
            <Textarea
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Scope, deliverables, collaborators, expected schedule, reporting line and what success looks like…"
              className={`${input} min-h-44`}
            />
          </Field>
          <Field
            id="job-requirements"
            label="Requirements"
            optional
            help="Split must-haves from nice-to-haves. Concrete skills (“reads charts”, “owns in-ear monitors”) beat vague ones."
            error={form.errors.requirements}
          >
            <Textarea
              value={f.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              placeholder="Must-haves vs nice-to-haves. Avoid vague 'rockstar' criteria."
              className={input}
            />
          </Field>
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
          <MoreDetails>
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
              <label className="flex gap-2 items-center md:col-span-2">
                <Checkbox checked={f.portfolioRequired} onCheckedChange={(v) => set('portfolioRequired', !!v)} />
                <span className="text-sm">Require a portfolio / work sample</span>
              </label>
            </div>
          </MoreDetails>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <ListChecks aria-hidden="true" size={20} className="text-violet-300" />
              Review your opportunity
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
              />
              <ReviewRow label="Pay" value={payText} onEdit={() => goTo(1)} />
              <ReviewRow
                label="Dates"
                value={[
                  f.applicationDeadline && `Apply by ${formatDate(f.applicationDeadline)}`,
                  f.startDate && `starts ${formatDate(f.startDate)}`,
                  f.duration,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onEdit={() => goTo(1)}
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
              Opportunities are reviewed for clarity, trust and suspicious off-platform fee/contact language. Verified
              hirers receive a trust marker, but verification never replaces your own checks on an applicant.
            </p>
          </div>
        </div>
      ),
    },
  ];
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 sm:px-5 md:px-6 pt-28 pb-16">
        <PageHeader
          help={
            job ? undefined : (
              <HelpCallout
                id="post-job"
                title="How posting works"
                steps={[
                  { icon: PenLine, title: 'Describe the work', text: 'Three quick steps. Save a draft at any point.' },
                  {
                    icon: BadgeCheck,
                    title: 'We review it',
                    text: 'Our team checks every opportunity for clarity and safety before it goes live.',
                  },
                  {
                    icon: Inbox,
                    title: 'Applicants arrive',
                    text: 'Answers, samples and messages land in Applications, ready to shortlist.',
                  },
                ]}
              />
            )
          }
          title={job ? job.title || 'Untitled opportunity' : 'Post an opportunity'}
          hint={job ? `Editing · ${jobStatusLabel[job.status] || job.status}` : 'Three short steps'}
          actions={<AiCreditsBadge />}
        />
        <div className={draftChecked ? undefined : 'invisible'} data-testid="post-job-body" aria-busy={!draftChecked}>
          {limits && (
            <p
              role="status"
              data-testid="plan-line"
              className={`mb-5 rounded-xl border p-3 text-sm ${atLimit ? 'border-amber-400/30 bg-amber-500/[.08] text-amber-100' : 'border-white/10 bg-white/[.03] text-slate-300'}`}
            >
              {limits.planName || 'Your'} plan: {limits.activeUsed} of {limits.activeAllowed} active
              {atLimit && (
                <>
                  {' '}
                  — upgrade to post more.{' '}
                  <Link to={billingPath} className="font-semibold underline underline-offset-4">
                    See plans
                  </Link>
                </>
              )}
            </p>
          )}
          {offeredDraft && !job && !draftId && (
            <div
              role="note"
              data-testid="draft-offer"
              className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-500/[.08] p-4 text-sm text-violet-100"
            >
              <span className="min-w-[14rem] flex-1 basis-full sm:basis-0">
                You have an unfinished draft:{' '}
                <strong className="break-words">{offeredDraft.title || 'Untitled'}</strong>
                <span className="block text-violet-200/80">
                  Starting a new one replaces it, so drafts never pile up.
                </span>
              </span>
              <Button size="sm" className="max-sm:flex-1" onClick={() => continueDraft(offeredDraft.id)}>
                Continue draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="max-sm:flex-1"
                onClick={() => {
                  // One draft at a time: the new listing is saved into the old draft's slot, not beside it.
                  draftRef.current = offeredDraft.id;
                  setDraftId(offeredDraft.id);
                  setOfferedDraft(null);
                }}
              >
                Start a new one
              </Button>
            </div>
          )}
          {job?.status === 'published' && (
            <div
              role="note"
              className="mb-5 rounded-xl border border-sky-400/20 bg-sky-500/[.07] p-4 text-sm text-sky-100"
            >
              This opportunity is live. Changes to pay, dates and slots apply straight away.
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
            {reviewEdited && (
              <p
                role="note"
                className="mt-5 rounded-xl border border-amber-400/25 bg-amber-500/[.08] p-3 text-sm text-amber-100"
              >
                Changes to the title, description or requirements send the opportunity back to review. It stays hidden
                from search until it is approved.
              </p>
            )}
            {submitBlocked && step === last && (
              <p
                role="note"
                data-testid="limit-note"
                className="mt-5 rounded-xl border border-amber-400/25 bg-amber-500/[.08] p-3 text-sm text-amber-100"
              >
                Your plan has no room for another active opportunity. Close one or{' '}
                <Link to={billingPath} className="font-semibold underline underline-offset-4">
                  upgrade your plan
                </Link>{' '}
                to submit this. You can still save it as a draft.
              </p>
            )}
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
              {autosave && (
                <p role="status" className="text-xs text-slate-400 sm:ml-2">
                  {autosave === 'saved' ? 'Draft saved' : 'Couldn’t save the draft yet. Your answers are still here.'}
                </p>
              )}
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
                  <Button
                    key="submit"
                    disabled={busy || submitBlocked}
                    aria-busy={busy}
                    type="submit"
                    className="min-w-44"
                  >
                    <Send aria-hidden="true" size={16} className="mr-2" />
                    {busy ? 'Saving…' : primary.label}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </div>
      </main>
      <PostJobPlanLimitDialog
        message={planLimitMessage}
        billingPath={billingPath}
        // No dedicated "manage active listings" route exists for either role; both dashboards
        // hold the OpportunityPipeline the listing would be closed from.
        closeListingsPath={seeker ? '/jobseeker/hiring/post' : '/employer'}
        onNavigate={(path) => {
          setPlanLimitMessage(null);
          nav(path);
        }}
        onKeepAsDraft={() => {
          setPlanLimitMessage(null);
          done();
        }}
      />
    </div>
  );
}
