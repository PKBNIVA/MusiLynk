import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Eye,
  ExternalLink,
  MailCheck,
  Music,
  Save,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
  WandSparkles,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import { HelpCallout } from '../components/help/HelpCallout';
import { MoreDetails } from '../components/help/MoreDetails';
import { StepForm, ReviewRow, focusStepHeading } from '../components/help/StepForm';
import { Checkbox } from '../components/ui/checkbox';
import { DebugLinkDialog, VerificationRequestDialog } from '../components/VerificationDialogs';
import { errorMessage } from '../lib/errors';
import type { AccountUser } from '../lib/apiTypes';
import { Field, FormError } from '../components/form/Field';
import { PHONE_MESSAGE, URL_MESSAGE, isHttpUrl, isPhone, useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { AppSelect } from '../components/ui/app-select';
import { AiSuggestButton } from '../components/ai/AiSuggestButton';
import { AutocompleteInput } from '../components/ai/AutocompleteInput';
import { AiCreditsBadge } from '../components/ai/AiCreditsBadge';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { ShareBadgeSection } from '../components/ShareBadgeSection';
import { buildBio, buildHeadline, type ProfileFacts } from '../lib/profileTemplates';
// List fields arrive as arrays and are edited as text: comma-separated, credits one per line.
type ListField =
  'skills' | 'genres' | 'instruments' | 'languages' | 'credits' | 'openTo' | 'roles' | 'gear' | 'software';
type NumberField = 'yearsExperience' | 'hourlyRate' | 'sessionRate' | 'showRate' | 'tourDayRate' | 'dayRate';
// The form holds list fields as text and number fields as whatever the input last produced.
type ProfileForm = Partial<
  Omit<AccountUser, ListField | NumberField> & Record<ListField, string> & Record<NumberField, number | string | null>
>;
type ProfileSource = Omit<ProfileForm, ListField> & Partial<Record<ListField, string[] | string>>;
const joinList = (v: unknown, sep: string) => (Array.isArray(v) ? v.join(sep) : String(v ?? ''));
const toForm = (user: ProfileSource): ProfileForm => ({
  ...user,
  skills: joinList(user.skills, ', '),
  genres: joinList(user.genres, ', '),
  instruments: joinList(user.instruments, ', '),
  languages: joinList(user.languages, ', '),
  credits: joinList(user.credits, '\n'),
  openTo: joinList(user.openTo, ', '),
  roles: joinList(user.roles, ', '),
  gear: joinList(user.gear, ', '),
  software: joinList(user.software, ', '),
});
// Limits match the Profile model (TEXT_LIMITS); counters show them while typing.
const LIMITS = {
  headline: 160,
  location: 120,
  experience: 60,
  availability: 120,
  bio: 2_000,
  website: 500,
  portfolioUrl: 500,
  phone: 20,
} as const;
type TextField = 'headline' | 'location' | 'experience' | 'availability' | 'bio' | 'website' | 'portfolioUrl' | 'phone';
type ProfileField = TextField | ListField | NumberField | 'currency';
const NUMBER_LABELS: Record<NumberField, string> = {
  yearsExperience: 'Years of experience',
  hourlyRate: 'Hourly rate',
  sessionRate: 'Session rate',
  showRate: 'Show rate',
  tourDayRate: 'Tour day rate',
  dayRate: 'Typical day / session rate',
};
const MAX_NUMBER = 2_000_000_000;
const STEP_IDS = ['about', 'music', 'rates', 'review'] as const;
/* Which step shows each field, so a failed save opens the step holding the first problem. */
const FIELD_STEP: Partial<Record<ProfileField, number>> = {
  headline: 0,
  location: 0,
  experience: 0,
  availability: 0,
  bio: 0,
  skills: 1,
  genres: 1,
  instruments: 1,
  languages: 1,
  credits: 1,
  openTo: 1,
  roles: 1,
  gear: 1,
  software: 1,
  yearsExperience: 1,
};
const RATE_HELP: Partial<Record<NumberField, string>> = {
  hourlyRate: 'What you charge per hour, e.g. for lessons or short rehearsals.',
  sessionRate: 'Your usual fee for one studio session (typically 3–4 hours).',
  showRate: 'Your fee for one live performance, before travel and stay.',
  tourDayRate: 'Your daily fee while on tour, including travel days.',
  dayRate: 'The single number people see first on your profile. Use your most common booking.',
};
const fieldId = (name: string) => `profile-${name}`;

/** The same rules the API applies (profiles#update and the Profile model), checked before sending. */
function validateProfile(f: ProfileForm) {
  const errors: Partial<Record<ProfileField, string>> = {};
  const text = (k: TextField) => String(f[k] ?? '').trim();
  (Object.keys(LIMITS) as TextField[]).forEach((k) => {
    if (text(k).length > LIMITS[k]) errors[k] = `Keep this under ${LIMITS[k].toLocaleString()} characters.`;
  });
  (['website', 'portfolioUrl'] as const).forEach((k) => {
    if (!errors[k] && text(k) && !isHttpUrl(text(k))) errors[k] = URL_MESSAGE;
  });
  if (!errors.phone && text('phone') && !isPhone(text('phone'))) errors.phone = PHONE_MESSAGE;
  (Object.keys(NUMBER_LABELS) as NumberField[]).forEach((k) => {
    const raw = f[k];
    if (raw === null || raw === undefined || raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) errors[k] = `${NUMBER_LABELS[k]} must be a number.`;
    else if (n < 0) errors[k] = `${NUMBER_LABELS[k]} cannot be negative.`;
    else if (n > MAX_NUMBER) errors[k] = `${NUMBER_LABELS[k]} is too large.`;
  });
  return errors;
}

export default function ProfileSetup() {
  const { setUser } = useAuth();
  const form = useFormErrors<ProfileField>({ idFor: fieldId });
  const submit = useSubmitOnce();
  const saving = submit.busy;
  const [searchParams] = useSearchParams();
  const [f, setF] = useState<ProfileForm>({}),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    // The post-sign-up welcome card links here with ?verify=1 to open the verification request.
    [verifying, setVerifying] = useState(() => searchParams.get('verify') === '1'),
    [emailError, setEmailError] = useState(''),
    [debugLink, setDebugLink] = useState<string | null>(null);
  const load = () => {
    setLoadError('');
    apiGet<{ user: AccountUser }>('/me')
      .then(({ user }) => {
        setF(toForm(user));
        setLoaded(true);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'Your profile could not be loaded.')));
  };
  useEffect(load, []);
  const [step, setStep] = useState(0);
  const last = STEP_IDS.length - 1;
  const goTo = (index: number) => {
    flushSync(() => setStep(index));
    focusStepHeading(STEP_IDS[index]);
  };
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    form.clear(k as ProfileField);
  };
  const list = (v?: string) =>
    String(v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!loaded) return;
    void submit.run(async () => {
      form.setFormError('');
      const errors = validateProfile(f);
      if (form.setErrors(errors)) {
        const steps = (Object.keys(errors) as ProfileField[]).map((k) => FIELD_STEP[k] ?? 2);
        flushSync(() => setStep(Math.min(...steps)));
        form.focusFirst();
        return;
      }
      try {
        const payload = {
          ...f,
          skills: list(f.skills),
          genres: list(f.genres),
          instruments: list(f.instruments),
          languages: list(f.languages),
          openTo: list(f.openTo),
          roles: list(f.roles),
          gear: list(f.gear),
          software: list(f.software),
          credits: String(f.credits || '')
            .split('\n')
            .map((x: string) => x.trim())
            .filter(Boolean),
        };
        const d = await apiPut<{ user: AccountUser }>('/profile', payload);
        setUser(d.user);
        setF(toForm({ ...f, ...d.user }));
        toast.success('Career profile saved');
      } catch (e: unknown) {
        if (form.setFromApi(e, 'Your profile could not be saved. Try again.')) {
          flushSync(() => {});
          const owner = document
            .querySelector<HTMLElement>('[data-step] [aria-invalid="true"]')
            ?.closest<HTMLElement>('[data-step]');
          const index = STEP_IDS.indexOf(owner?.dataset.step as (typeof STEP_IDS)[number]);
          if (index >= 0) flushSync(() => setStep(index));
          form.focusFirst();
        }
      }
    });
  }
  async function verify(evidenceUrl: string, note: string) {
    await apiPost('/verification-requests', {
      kind: 'professional',
      evidenceUrl,
      ...(note ? { note } : {}),
    });
    toast.success('Verification request submitted for review');
  }
  async function verifyEmail() {
    setEmailError('');
    try {
      const d = await apiPost<{ ok?: boolean; alreadyVerified?: boolean; debugLink?: string }>(
        '/auth/request-email-verification',
        {},
      );
      if (d.alreadyVerified) toast.success('Email already verified');
      else {
        toast.success('Verification email requested');
        if (d.debugLink) setDebugLink(d.debugLink);
      }
    } catch (e: unknown) {
      setEmailError(errorMessage(e, 'The verification email could not be sent. Try again.'));
    }
  }
  type TextOptions = {
    placeholder?: string;
    type?: 'text' | 'url' | 'tel';
    inputMode?: 'text' | 'url' | 'tel';
    autoComplete?: string;
    hint?: string;
    help?: string;
    className?: string;
  };
  const textField = (k: TextField | Exclude<ListField, 'credits'>, label: string, o: TextOptions = {}) => {
    const max = k in LIMITS ? LIMITS[k as TextField] : undefined;
    const value = String(f[k] ?? '');
    return (
      <Field
        id={fieldId(k)}
        label={label}
        hint={o.hint}
        help={o.help}
        className={o.className}
        error={form.errors[k]}
        count={max !== undefined && value.length > max * 0.8 ? value.length : undefined}
        maxLength={max !== undefined && value.length > max * 0.8 ? max : undefined}
      >
        <Input
          type={o.type ?? 'text'}
          inputMode={o.inputMode}
          autoComplete={o.autoComplete}
          maxLength={max}
          value={value}
          onChange={(e) => set(k, e.target.value)}
          placeholder={o.placeholder}
          className="bg-black/20 border-white/15"
        />
      </Field>
    );
  };
  const numberField = (k: NumberField) => (
    <Field id={fieldId(k)} label={NUMBER_LABELS[k]} error={form.errors[k]} help={RATE_HELP[k]}>
      <Input
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={f[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        className="bg-black/20 border-white/15"
      />
    </Field>
  );
  // Shared context for profile_headline / profile_bio: only the fields the task allow-lists.
  const profileAiContext = () => ({
    roles: list(f.roles),
    skills: list(f.skills),
    genres: list(f.genres),
    city: f.location || '',
    credits: String(f.credits || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
  });
  // No-AI drafts from the roles, city, years, genres and credits already on this form.
  const profileFacts = (): ProfileFacts => ({
    roles: list(f.roles),
    city: String(f.location || ''),
    years: f.yearsExperience,
    genres: list(f.genres),
    credits: String(f.credits || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
  });
  const templateButton = (field: 'headline' | 'bio') => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 text-violet-200"
      onClick={() => {
        const draft = field === 'headline' ? buildHeadline(profileFacts()) : buildBio(profileFacts());
        if (!draft) {
          toast.info('Add your roles and city first (in Music skills and Base location), then try again.');
          return;
        }
        set(field, draft);
        toast.success(
          field === 'headline' ? 'Headline filled in. Edit it as you like.' : 'Bio filled in. Edit it as you like.',
        );
      }}
    >
      <WandSparkles aria-hidden="true" size={14} />
      Fill from my details
    </Button>
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
          <PageHeader title="Your profile" className="!mb-0" />
          <div className="flex gap-2 flex-wrap items-center">
            {f.profileComplete && f.id && (
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/professionals/${f.id}`} target="_blank" rel="noopener">
                  View public profile
                  <ExternalLink aria-hidden="true" size={14} className="ml-2" />
                </Link>
              </Button>
            )}
            <AiCreditsBadge />
            {f.emailVerified ? (
              <Badge className="bg-sky-500/15 text-sky-300">
                <MailCheck size={14} className="mr-1" />
                Email verified
              </Badge>
            ) : (
              <Button variant="outline" onClick={verifyEmail}>
                Verify email
              </Button>
            )}
            {f.verified ? (
              <VerifiedBadge className="bg-emerald-500/15 text-emerald-300" />
            ) : (
              <Button variant="outline" onClick={() => setVerifying(true)}>
                <ShieldCheck size={16} className="mr-2" />
                Request verification
              </Button>
            )}
          </div>
          {f.verified && (
            <div className="w-full md:w-auto space-y-3">
              {f.id && <ShareBadgeSection userId={f.id} />}
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <Checkbox
                  checked={f.shareVerificationPublicly !== false}
                  onCheckedChange={(v) => set('shareVerificationPublicly', !!v)}
                />
                Announce my verification on The Stage and let others share my badge card
              </label>
            </div>
          )}
        </div>
        <FormError message={emailError} className="mb-5" />
        {loadError && (
          <div role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm">
            <p>{loadError}</p>
            <p className="text-slate-400 mt-1">
              Saving is disabled until your current profile loads, so nothing is overwritten.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        <HelpCallout
          id="profile-setup"
          title="How your profile gets you hired"
          steps={[
            {
              icon: UserRound,
              title: 'Say what you do',
              text: 'A clear headline and base city put you in the right searches.',
            },
            { icon: Music, title: 'Show your sound', text: 'Skills, genres and credits are what hirers filter by.' },
            {
              icon: Search,
              title: 'Get found',
              text: 'Rates and links help bookers say yes without a long back-and-forth.',
            },
          ]}
        />
        <form onSubmit={save} className="verse-surface rounded-3xl p-5 md:p-8" noValidate>
          <StepForm
            current={step}
            reached={last}
            onStepChange={goTo}
            steps={[
              {
                id: STEP_IDS[0],
                title: 'About you',
                icon: UserRound,
                description: 'The first things people read on your profile.',
                content: (
                  <div className="grid md:grid-cols-2 gap-5">
                    <Field
                      id={fieldId('headline')}
                      label="Professional headline"
                      labelExtra={
                        <>
                          {templateButton('headline')}
                          <AiSuggestButton
                            task="profile_headline"
                            label="Write with AI"
                            getContext={profileAiContext}
                            onAccept={(text) => set('headline', text)}
                          />
                        </>
                      }
                      error={form.errors.headline}
                      count={
                        String(f.headline || '').length > LIMITS.headline * 0.8
                          ? String(f.headline || '').length
                          : undefined
                      }
                      maxLength={String(f.headline || '').length > LIMITS.headline * 0.8 ? LIMITS.headline : undefined}
                    >
                      <Input
                        maxLength={LIMITS.headline}
                        value={String(f.headline ?? '')}
                        onChange={(e) => set('headline', e.target.value)}
                        placeholder="Playback singer · Vocal producer · Hindi / Punjabi"
                        className="bg-black/20 border-white/15"
                      />
                    </Field>
                    <div>
                      <AutocompleteInput
                        id={fieldId('location')}
                        field="cities"
                        label="Base location"
                        multiple={false}
                        values={f.location ? [String(f.location)] : []}
                        onChange={(vs) => set('location', vs[0] || '')}
                        placeholder="Mumbai, Maharashtra"
                      />
                    </div>
                    {textField('experience', 'Experience', { placeholder: '5 years / 30+ sessions / emerging' })}
                    {textField('availability', 'Availability', {
                      placeholder: 'Available weekends / touring Oct–Dec',
                      help: 'A short note on when you can work. For exact dates, use the Availability calendar.',
                    })}
                    <Field
                      id={fieldId('bio')}
                      label="Bio"
                      labelExtra={
                        <>
                          {templateButton('bio')}
                          <AiSuggestButton
                            task="profile_bio"
                            label="Write with AI"
                            getContext={profileAiContext}
                            onAccept={(text) => set('bio', text)}
                          />
                          {String(f.bio || '').trim() && (
                            <AiSuggestButton
                              task="improve_text"
                              label="Improve"
                              value={String(f.bio || '')}
                              getContext={() => ({ tone: 'clearer', text: String(f.bio || '') })}
                              onAccept={(text) => set('bio', text)}
                            />
                          )}
                        </>
                      }
                      className="md:col-span-2"
                      error={form.errors.bio}
                      count={String(f.bio || '').length}
                      maxLength={LIMITS.bio}
                    >
                      <Textarea
                        maxLength={LIMITS.bio}
                        value={f.bio || ''}
                        onChange={(e) => set('bio', e.target.value)}
                        placeholder="What you do, the contexts you work best in, notable experience and what you are looking for next."
                        className="bg-black/20 border-white/15 min-h-32"
                      />
                    </Field>
                  </div>
                ),
              },
              {
                id: STEP_IDS[1],
                title: 'Music skills',
                icon: Music,
                description: 'Separate several entries with commas. These are what hirers search for.',
                content: (
                  <div className="space-y-5">
                    <div className="grid md:grid-cols-2 gap-5">
                      <AutocompleteInput
                        id={fieldId('skills')}
                        field="skills"
                        label="Skills"
                        values={list(f.skills)}
                        onChange={(vs) => set('skills', vs.join(', '))}
                        placeholder="Mixing, toplining, vocal production"
                      />
                      <AutocompleteInput
                        id={fieldId('genres')}
                        field="genres"
                        label="Genres"
                        values={list(f.genres)}
                        onChange={(vs) => set('genres', vs.join(', '))}
                        placeholder="Bollywood, Indie Pop, Hip-Hop"
                      />
                      <AutocompleteInput
                        id={fieldId('instruments')}
                        field="instruments"
                        label="Instruments / voice"
                        values={list(f.instruments)}
                        onChange={(vs) => set('instruments', vs.join(', '))}
                        placeholder="Vocals, guitar, keys"
                      />
                      <AutocompleteInput
                        id={fieldId('roles')}
                        field="roles"
                        label="Professional roles"
                        values={list(f.roles)}
                        onChange={(vs) => set('roles', vs.join(', '))}
                        placeholder="Session Bassist, Musical Director, FOH Engineer"
                      />
                      {textField('openTo', 'Open to', {
                        placeholder: 'Sessions, touring, full-time, sync, collaborations',
                        className: 'md:col-span-2',
                        help: 'The kinds of work you want to be offered. Verse uses this to match you to opportunities.',
                      })}
                      <Field
                        id={fieldId('credits')}
                        label="Selected credits"
                        hint="One per line."
                        help="Releases, shows or projects you worked on and your role. Three strong credits beat a long list."
                        className="md:col-span-2"
                        error={form.errors.credits}
                      >
                        <Textarea
                          value={f.credits || ''}
                          onChange={(e) => set('credits', e.target.value)}
                          placeholder="Track / project — role — artist / company — year"
                          className="bg-black/20 border-white/15 min-h-32"
                        />
                      </Field>
                    </div>
                    <MoreDetails
                      label="More details (optional): languages, gear, travel"
                      defaultOpen={!!(f.languages || f.gear || f.software || f.yearsExperience)}
                      forceOpen={
                        !!(
                          form.errors.languages ||
                          form.errors.gear ||
                          form.errors.software ||
                          form.errors.yearsExperience
                        )
                      }
                    >
                      <div className="grid md:grid-cols-2 gap-5">
                        {textField('languages', 'Languages', { placeholder: 'Hindi, English, Punjabi' })}
                        {numberField('yearsExperience')}
                        {textField('gear', 'Gear / consoles / instruments', {
                          placeholder: 'Fender Jazz V, DiGiCo Quantum, IEM rig',
                        })}
                        {textField('software', 'Software / DAWs', {
                          placeholder: 'Pro Tools, Logic Pro, Ableton Live',
                        })}
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm text-slate-300">
                        <label className="flex gap-2 items-center">
                          <Checkbox
                            checked={!!f.remoteRecording}
                            onCheckedChange={(v) => set('remoteRecording', !!v)}
                          />
                          Remote recording ready
                        </label>
                        <label className="flex gap-2 items-center">
                          <Checkbox checked={!!f.sightReading} onCheckedChange={(v) => set('sightReading', !!v)} />
                          Sight-reading
                        </label>
                        <label className="flex gap-2 items-center">
                          <Checkbox checked={!!f.passportReady} onCheckedChange={(v) => set('passportReady', !!v)} />
                          Passport / tour ready
                        </label>
                        <label className="flex gap-2 items-center">
                          <Checkbox
                            checked={!!f.travelsNationally}
                            onCheckedChange={(v) => set('travelsNationally', !!v)}
                          />
                          Travels nationally
                        </label>
                        <label className="flex gap-2 items-center">
                          <Checkbox
                            checked={!!f.travelsInternationally}
                            onCheckedChange={(v) => set('travelsInternationally', !!v)}
                          />
                          Travels internationally
                        </label>
                      </div>
                    </MoreDetails>
                  </div>
                ),
              },
              {
                id: STEP_IDS[2],
                title: 'Rates & links',
                icon: Wallet,
                description: 'Only the day rate shows publicly; the rest help bookers send better offers.',
                content: (
                  <div className="grid md:grid-cols-2 gap-5">
                    {textField('website', 'Website', {
                      type: 'url',
                      inputMode: 'url',
                      autoComplete: 'url',
                      placeholder: 'https://your-site.com',
                      hint: 'Include https://',
                    })}
                    {textField('portfolioUrl', 'Primary portfolio / showreel URL', {
                      type: 'url',
                      inputMode: 'url',
                      placeholder: 'https://youtube.com/…',
                      hint: 'Include https://',
                      help: 'Your best single link: a showreel, a playlist or a live video. It is the first thing hirers click.',
                    })}
                    {numberField('dayRate')}
                    <Field id={fieldId('currency')} label="Currency" error={form.errors.currency}>
                      <AppSelect
                        value={f.currency || 'INR'}
                        onValueChange={(v) => set('currency', v)}
                        options={['INR', 'USD', 'EUR', 'GBP']}
                      />
                    </Field>
                    {numberField('hourlyRate')}
                    {numberField('sessionRate')}
                    {numberField('showRate')}
                    {numberField('tourDayRate')}
                    {textField('phone', 'Phone', {
                      type: 'tel',
                      inputMode: 'tel',
                      autoComplete: 'tel',
                      placeholder: '+91 98765 43210',
                      help: 'Only shared with people you have agreed to work with. Never shown publicly.',
                    })}
                  </div>
                ),
              },
              {
                id: STEP_IDS[3],
                title: 'Review',
                icon: ClipboardCheck,
                description: 'A quick look at what hirers will see. Save when it looks right.',
                content: (
                  <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
                    <h3 className="mb-2 flex items-center gap-2 font-semibold">
                      <Eye aria-hidden="true" size={20} className="text-violet-300" />
                      Your profile at a glance
                    </h3>
                    <dl>
                      <ReviewRow label="Headline" value={f.headline} onEdit={() => goTo(0)} />
                      <ReviewRow label="Based in" value={f.location} onEdit={() => goTo(0)} />
                      <ReviewRow label="Skills" value={f.skills} onEdit={() => goTo(1)} />
                      <ReviewRow label="Genres" value={f.genres} onEdit={() => goTo(1)} />
                      <ReviewRow
                        label="Credits"
                        value={
                          f.credits
                            ? `${
                                String(f.credits)
                                  .split('\n')
                                  .filter((x) => x.trim()).length
                              } listed`
                            : ''
                        }
                        onEdit={() => goTo(1)}
                      />
                      <ReviewRow
                        label="Day rate"
                        value={f.dayRate ? `${f.currency || 'INR'} ${f.dayRate}` : ''}
                        onEdit={() => goTo(2)}
                      />
                      <ReviewRow label="Showreel" value={f.portfolioUrl} onEdit={() => goTo(2)} />
                    </dl>
                  </div>
                ),
              },
            ]}
          />
          <FormError message={form.formError} className="mt-5" />
          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
            {step > 0 && (
              <Button type="button" variant="ghost" onClick={() => goTo(step - 1)}>
                <ArrowLeft aria-hidden="true" size={16} className="mr-2" />
                Back
              </Button>
            )}
            <div className="flex flex-col-reverse gap-3 sm:ml-auto sm:flex-row">
              <Button
                type="submit"
                variant={step < last ? 'outline' : 'default'}
                className={step < last ? '' : 'min-w-48'}
                disabled={saving || !loaded}
                aria-busy={saving}
              >
                <Save aria-hidden="true" size={16} className="mr-2" />
                {saving ? 'Saving…' : loaded ? 'Save career profile' : 'Loading profile…'}
              </Button>
              {step < last && (
                <Button type="button" onClick={() => goTo(step + 1)} className="min-w-36">
                  Next: {['Music skills', 'Rates & links', 'Review'][step]}
                  <ArrowRight aria-hidden="true" size={16} className="ml-2" />
                </Button>
              )}
            </div>
          </div>
        </form>
      </main>
      <VerificationRequestDialog open={verifying} onOpenChange={setVerifying} onSubmit={verify} />
      <DebugLinkDialog link={debugLink} onClose={() => setDebugLink(null)} />
    </div>
  );
}
