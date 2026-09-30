import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet, apiPost, apiPut, ApiError } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Link2,
  LoaderCircle,
  MailCheck,
  Music,
  Save,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import { HelpCallout } from '../components/help/HelpCallout';
import { MoreDetails } from '../components/help/MoreDetails';
import { Checkbox } from '../components/ui/checkbox';
import { DebugLinkDialog, VerificationRequestDialog } from '../components/VerificationDialogs';
import { errorMessage } from '../lib/errors';
import { formatWhen } from '../lib/format';
import type { AccountUser } from '../lib/apiTypes';
import { Field, FormError } from '../components/form/Field';
import {
  PHONE_MESSAGE,
  URL_MESSAGE,
  fieldErrorsFromApi,
  isHttpUrl,
  isPhone,
  useFormErrors,
  useSubmitOnce,
} from '../lib/formErrors';
import { AppSelect } from '../components/ui/app-select';
import { AiSuggestButton } from '../components/ai/AiSuggestButton';
import { AutocompleteInput } from '../components/ai/AutocompleteInput';
import { AiCreditsBadge } from '../components/ai/AiCreditsBadge';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { ShareBadgeSection } from '../components/ShareBadgeSection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { buildBio, buildHeadline, type ProfileFacts } from '../lib/profileTemplates';
import {
  forgetPendingVerification,
  normalizeWebAddress,
  pendingVerificationSince,
  rememberPendingVerification,
} from '../lib/profileForm';

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
const RATE_HELP: Partial<Record<NumberField, string>> = {
  hourlyRate: 'What you charge per hour, e.g. for lessons or short rehearsals.',
  sessionRate: 'Your usual fee for one studio session (typically 3–4 hours).',
  showRate: 'Your fee for one live performance, before travel and stay.',
  tourDayRate: 'Your daily fee while on tour, including travel days.',
  dayRate: 'The single number people see first on your profile. Use your most common booking.',
};
const fieldId = (name: string) => `profile-${name}`;

type FormKey = keyof ProfileForm;
type SectionId = 'about' | 'skills' | 'rates' | 'links' | 'verification';
interface SectionDef {
  id: SectionId;
  title: string;
  icon: LucideIcon;
  description: string;
  /** The profile fields this section edits, and therefore saves on its own. */
  fields: readonly FormKey[];
}
const SECTIONS: readonly SectionDef[] = [
  {
    id: 'about',
    title: 'About',
    icon: UserRound,
    description: 'The first things people read on your profile.',
    fields: ['headline', 'location', 'experience', 'bio'],
  },
  {
    id: 'skills',
    title: 'Skills & genres',
    icon: Music,
    description: 'What hirers search for. Separate several entries with commas.',
    fields: [
      'skills',
      'genres',
      'instruments',
      'roles',
      'openTo',
      'credits',
      'languages',
      'yearsExperience',
      'gear',
      'software',
      'remoteRecording',
      'sightReading',
      'passportReady',
      'travelsNationally',
      'travelsInternationally',
    ],
  },
  {
    id: 'rates',
    title: 'Rates & availability',
    icon: Wallet,
    description: 'Only the day rate shows on the list; the rest help bookers send better offers.',
    fields: ['availability', 'dayRate', 'currency', 'sessionRate', 'showRate', 'hourlyRate', 'tourDayRate'],
  },
  {
    id: 'links',
    title: 'Links',
    icon: Link2,
    description: 'Where hirers can hear and see more of your work.',
    fields: ['website', 'portfolioUrl', 'phone'],
  },
  {
    id: 'verification',
    title: 'Verification',
    icon: ShieldCheck,
    description: 'A verified badge tells hirers your work is real.',
    fields: ['shareVerificationPublicly'],
  },
];
const SECTION_OF = new Map<string, SectionId>(
  SECTIONS.flatMap((s) => s.fields.map((k) => [k as string, s.id] as const)),
);
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
/** How long after the last keystroke a changed section saves itself. */
const AUTOSAVE_MS = 1_200;

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

/** Web addresses typed as "example.com" are completed to https:// before they are checked or sent. */
function normalizeAddresses(f: ProfileForm): ProfileForm {
  const out = { ...f };
  (['website', 'portfolioUrl'] as const).forEach((k) => {
    if (typeof out[k] === 'string') out[k] = normalizeWebAddress(out[k]);
  });
  return out;
}

const listOf = (v?: string) =>
  String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const creditsOf = (v?: string) =>
  String(v || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
const LIST_FIELDS: readonly FormKey[] = [
  'skills',
  'genres',
  'instruments',
  'languages',
  'openTo',
  'roles',
  'gear',
  'software',
];
/** The PUT /profile body for these fields: lists as arrays, everything else as the form holds it. */
function payloadFor(f: ProfileForm, keys: readonly FormKey[]) {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    const value = f[key];
    body[key] = key === 'credits' ? creditsOf(f.credits) : LIST_FIELDS.includes(key) ? listOf(value as string) : value;
  }
  return body;
}
/** Blank, undefined and false all mean "nothing set", so toggling a box on and off is not a change. */
const same = (a: unknown, b: unknown) => {
  const flat = (v: unknown) => (v === null || v === undefined || v === false ? '' : String(v));
  return flat(a) === flat(b);
};

type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export default function ProfileSetup() {
  const { setUser, user: sessionUser } = useAuth();
  const form = useFormErrors<ProfileField>({ idFor: fieldId });
  const submit = useSubmitOnce();
  const saving = submit.busy;
  const [searchParams] = useSearchParams();
  const [f, setF] = useState<ProfileForm>({}),
    // What the server holds, so each section knows whether it has unsaved changes.
    [base, setBase] = useState<ProfileForm>({}),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    // The post-sign-up welcome card links here with ?verify=1 to open the verification request.
    [verifying, setVerifying] = useState(() => searchParams.get('verify') === '1'),
    [emailError, setEmailError] = useState(''),
    [debugLink, setDebugLink] = useState<string | null>(null),
    [pendingSince, setPendingSince] = useState<string | null>(null),
    [savingSection, setSavingSection] = useState<Partial<Record<SectionId, boolean>>>({}),
    [savedSection, setSavedSection] = useState<Partial<Record<SectionId, boolean>>>({}),
    [sectionError, setSectionError] = useState<Partial<Record<SectionId, string>>>({});
  const fRef = useRef(f);
  fRef.current = f;
  const baseRef = useRef(base);
  baseRef.current = base;
  const timers = useRef<Partial<Record<SectionId, ReturnType<typeof setTimeout>>>>({});
  const inFlight = useRef<Partial<Record<SectionId, boolean>>>({});

  const load = () => {
    setLoadError('');
    apiGet<{ user: AccountUser }>('/me')
      .then(({ user }) => {
        setF(toForm(user));
        setBase(toForm(user));
        setPendingSince(pendingVerificationSince(user.id));
        setLoaded(true);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'Your profile could not be loaded.')));
  };
  useEffect(load, []);

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    form.clear(k as ProfileField);
    const owner = SECTION_OF.get(k as string);
    if (owner) setSectionError((current) => (current[owner] ? { ...current, [owner]: '' } : current));
  };
  const dirty = (id: SectionId, current: ProfileForm = f, saved: ProfileForm = base) =>
    (SECTIONS.find((s) => s.id === id)?.fields ?? []).some((k) => !same(current[k], saved[k]));
  const statusOf = (id: SectionId): Status =>
    savingSection[id]
      ? 'saving'
      : dirty(id)
        ? sectionError[id] || SECTIONS.find((s) => s.id === id)?.fields.some((k) => form.errors[k as ProfileField])
          ? 'error'
          : 'dirty'
        : savedSection[id]
          ? 'saved'
          : 'idle';
  const anyUnsaved = loaded && SECTIONS.some((s) => dirty(s.id) || savingSection[s.id]);

  /** Saves one section's fields on their own. Resolves true when nothing is left unsaved in it. */
  const saveSection = useCallback(
    async (id: SectionId): Promise<boolean> => {
      clearTimeout(timers.current[id]);
      const section = SECTIONS.find((s) => s.id === id)!;
      const raw = fRef.current;
      const snapshot = normalizeAddresses(raw);
      if (!section.fields.some((k) => !same(snapshot[k], baseRef.current[k]))) return true;
      if (inFlight.current[id]) return false;
      const problems = validateProfile(snapshot);
      let invalid = false;
      for (const k of section.fields) {
        const message = problems[k as ProfileField] ?? '';
        if (message) invalid = true;
        form.setFieldError(k as ProfileField, message);
      }
      if (invalid) return false;
      inFlight.current[id] = true;
      setSavingSection((current) => ({ ...current, [id]: true }));
      setSectionError((current) => ({ ...current, [id]: '' }));
      try {
        const d = await apiPut<{ user: AccountUser }>('/profile', payloadFor(snapshot, section.fields));
        if (d?.user) setUser(d.user);
        const savedValues = Object.fromEntries(section.fields.map((k) => [k, snapshot[k]]));
        setBase((current) => ({ ...current, ...savedValues }));
        // A completed web address replaces what was typed, unless it has been edited again since.
        setF((current) => {
          const next = { ...current };
          (['website', 'portfolioUrl'] as const).forEach((k) => {
            if (section.fields.includes(k) && current[k] === raw[k] && snapshot[k] !== undefined) {
              next[k] = snapshot[k];
            }
          });
          return next;
        });
        setSavedSection((current) => ({ ...current, [id]: true }));
        return true;
      } catch (e: unknown) {
        const fields = fieldErrorsFromApi<ProfileField>(e instanceof ApiError ? e.fields : undefined);
        const placed = Object.entries(fields).filter(([k]) => section.fields.includes(k as FormKey));
        placed.forEach(([k, message]) => form.setFieldError(k as ProfileField, message as string));
        setSectionError((current) => ({
          ...current,
          [id]: placed.length
            ? 'Fix the highlighted fields to save this section.'
            : errorMessage(e, 'Not saved. Try again.'),
        }));
        return false;
      } finally {
        inFlight.current[id] = false;
        setSavingSection((current) => ({ ...current, [id]: false }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form's setters are stable
    [setUser],
  );

  // Autosave: a section that has changed saves itself a moment after typing stops, and when focus
  // leaves it (see onBlur below). Saved values leave the "unsaved" state; invalid ones stay put
  // with their message until they are fixed.
  useEffect(() => {
    if (!loaded) return;
    for (const s of SECTIONS) {
      clearTimeout(timers.current[s.id]);
      if (dirty(s.id, f, base)) timers.current[s.id] = setTimeout(() => void saveSection(s.id), AUTOSAVE_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescheduled on every edit
  }, [f, base, loaded, saveSection]);
  useEffect(
    () => () => {
      Object.values(timers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  // Leaving with unsaved changes: the tab close asks the browser; in-app navigation asks here.
  useEffect(() => {
    if (!anyUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyUnsaved]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => anyUnsaved && currentLocation.pathname !== nextLocation.pathname,
  );
  const saveAllAndLeave = async () => {
    const results = await Promise.all(SECTIONS.map((s) => saveSection(s.id)));
    if (results.every(Boolean)) blocker.proceed?.();
    else blocker.reset?.();
  };

  /** The whole profile in one request (the button at the bottom, and Enter in a field). */
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!loaded) return;
    void submit.run(async () => {
      form.setFormError('');
      Object.values(timers.current).forEach((timer) => clearTimeout(timer));
      const snapshot = normalizeAddresses(fRef.current);
      const errors = validateProfile(snapshot);
      if (form.setErrors(errors)) {
        form.focusFirst();
        return;
      }
      try {
        const d = await apiPut<{ user: AccountUser }>('/profile', payloadFor(snapshot, ALL_FIELDS));
        if (d?.user) setUser(d.user);
        setF(toForm({ ...snapshot, ...d?.user }));
        setBase(toForm({ ...snapshot, ...d?.user }));
        setSavedSection(Object.fromEntries(SECTIONS.map((s) => [s.id, true])));
        setSectionError({});
        toast.success('Career profile saved');
      } catch (e: unknown) {
        if (form.setFromApi(e, 'Your profile could not be saved. Try again.')) {
          flushSync(() => {});
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
    if (f.id) rememberPendingVerification(f.id);
    setPendingSince(new Date().toISOString());
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
  // An approved profile no longer needs the pending note.
  useEffect(() => {
    if (f.verified && f.id) forgetPendingVerification(f.id);
  }, [f.verified, f.id]);

  const goToSection = useCallback((id: SectionId) => {
    const el = document.getElementById(`profile-section-${id}`);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    try {
      window.history.replaceState(window.history.state, '', `#${id}`);
    } catch {
      /* the anchor still worked without the address bar */
    }
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, []);
  // The welcome card's ?verify=1 (and a #section link) land on the right section.
  useEffect(() => {
    if (!loaded) return;
    const wanted = searchParams.get('verify') === '1' ? 'verification' : window.location.hash.slice(1);
    if (SECTIONS.some((s) => s.id === wanted)) goToSection(wanted as SectionId);
  }, [loaded, searchParams, goToSection]);

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
          onBlur={k === 'website' || k === 'portfolioUrl' ? () => set(k, normalizeWebAddress(value)) : undefined}
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
    roles: listOf(f.roles),
    skills: listOf(f.skills),
    genres: listOf(f.genres),
    city: f.location || '',
    credits: creditsOf(f.credits),
  });
  // No-AI drafts from the roles, city, years, genres and credits already on this form.
  const profileFacts = (): ProfileFacts => ({
    roles: listOf(f.roles),
    city: String(f.location || ''),
    years: f.yearsExperience,
    genres: listOf(f.genres),
    credits: creditsOf(f.credits),
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
          toast.info('Add your roles and city first (in Skills & genres and Base location), then try again.');
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

  const statusLine = (id: SectionId) => {
    const status = statusOf(id);
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-sm">
        <p role="status" data-testid={`section-status-${id}`} className="flex items-center gap-1.5 text-slate-300">
          {status === 'saving' && (
            <>
              <LoaderCircle aria-hidden="true" size={15} className="animate-spin" /> Saving…
            </>
          )}
          {status === 'saved' && (
            <>
              <CheckCircle2 aria-hidden="true" size={15} className="text-emerald-300" /> Saved
            </>
          )}
          {status === 'dirty' && 'Unsaved changes'}
          {status === 'error' && <span className="text-rose-300">Not saved</span>}
        </p>
        {(status === 'dirty' || status === 'error') && (
          <Button type="button" size="sm" variant="outline" onClick={() => void saveSection(id)}>
            <Save aria-hidden="true" size={14} className="mr-1.5" />
            Save now
          </Button>
        )}
        {sectionError[id] && (
          <p role="alert" className="text-rose-300">
            {sectionError[id]}
          </p>
        )}
      </div>
    );
  };
  // A section saves when focus leaves it for somewhere outside.
  const sectionProps = (s: SectionDef) => ({
    id: `profile-section-${s.id}`,
    'aria-labelledby': `profile-section-${s.id}-title`,
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      const to = event.relatedTarget as HTMLElement | null;
      // Going to the whole-profile button saves everything in one request instead.
      if (loaded && !event.currentTarget.contains(to) && !to?.closest('[data-profile-save]')) void saveSection(s.id);
    },
    className: 'verse-surface scroll-mt-40 rounded-3xl p-5 md:p-8',
  });
  const heading = (s: SectionDef) => (
    <div className="mb-5">
      <h2
        id={`profile-section-${s.id}-title`}
        tabIndex={-1}
        className="flex items-center gap-2 text-2xl font-semibold outline-none"
      >
        <s.icon aria-hidden="true" size={24} className="text-violet-300" />
        {s.title}
      </h2>
      <p className="mt-1 text-sm text-slate-400">{s.description}</p>
    </div>
  );
  const [about, skills, rates, links, verification] = SECTIONS;
  const userId = f.id || sessionUser?.id || '';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
          <PageHeader
            title="Your profile"
            className="!mb-0"
            help={
              <HelpCallout
                id="profile-setup"
                title="How your profile gets you hired"
                steps={[
                  {
                    icon: UserRound,
                    title: 'Say what you do',
                    text: 'A clear headline and base city put you in the right searches.',
                  },
                  {
                    icon: Music,
                    title: 'Show your sound',
                    text: 'Skills, genres and credits are what hirers filter by.',
                  },
                  {
                    icon: Search,
                    title: 'Get found',
                    text: 'Rates and links help bookers say yes without a long back-and-forth.',
                  },
                ]}
              />
            }
          />
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
            {f.verified && <VerifiedBadge className="bg-emerald-500/15 text-emerald-300" />}
          </div>
        </div>
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
        <form onSubmit={save} noValidate className="lg:grid lg:grid-cols-[13rem_1fr] lg:items-start lg:gap-8">
          <nav
            aria-label="Profile sections"
            className="sticky top-16 z-20 -mx-5 mb-5 overflow-x-auto bg-slate-950/90 px-5 py-2 backdrop-blur md:-mx-6 md:px-6 lg:top-28 lg:mx-0 lg:mb-0 lg:overflow-visible lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
          >
            <ul className="flex gap-2 lg:flex-col">
              {SECTIONS.map((s) => {
                const status = statusOf(s.id);
                return (
                  <li key={s.id} className="shrink-0">
                    <a
                      href={`#${s.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        goToSection(s.id);
                      }}
                      className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm text-slate-200 hover:border-violet-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    >
                      <s.icon aria-hidden="true" size={16} className="text-violet-300" />
                      <span className="whitespace-nowrap">{s.title}</span>
                      {status === 'saved' && <CheckCircle2 aria-hidden="true" size={13} className="text-emerald-300" />}
                      {(status === 'dirty' || status === 'error') && (
                        <span
                          aria-hidden="true"
                          className={`size-2 rounded-full ${status === 'error' ? 'bg-rose-400' : 'bg-amber-300'}`}
                        />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0 space-y-6">
            <section {...sectionProps(about)}>
              {heading(about)}
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
                  className="md:col-span-2"
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
              {statusLine('about')}
            </section>

            <section {...sectionProps(skills)}>
              {heading(skills)}
              <div className="space-y-5">
                <div className="grid md:grid-cols-2 gap-5">
                  <AutocompleteInput
                    id={fieldId('skills')}
                    field="skills"
                    label="Skills"
                    values={listOf(f.skills)}
                    onChange={(vs) => set('skills', vs.join(', '))}
                    placeholder="Mixing, toplining, vocal production"
                  />
                  <AutocompleteInput
                    id={fieldId('genres')}
                    field="genres"
                    label="Genres"
                    values={listOf(f.genres)}
                    onChange={(vs) => set('genres', vs.join(', '))}
                    placeholder="Bollywood, Indie Pop, Hip-Hop"
                  />
                  <AutocompleteInput
                    id={fieldId('instruments')}
                    field="instruments"
                    label="Instruments / voice"
                    values={listOf(f.instruments)}
                    onChange={(vs) => set('instruments', vs.join(', '))}
                    placeholder="Vocals, guitar, keys"
                  />
                  <AutocompleteInput
                    id={fieldId('roles')}
                    field="roles"
                    label="Professional roles"
                    values={listOf(f.roles)}
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
                    !!(form.errors.languages || form.errors.gear || form.errors.software || form.errors.yearsExperience)
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
                      <Checkbox checked={!!f.remoteRecording} onCheckedChange={(v) => set('remoteRecording', !!v)} />
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
              {statusLine('skills')}
            </section>

            <section {...sectionProps(rates)}>
              {heading(rates)}
              <div className="grid md:grid-cols-2 gap-5">
                {textField('availability', 'Availability', {
                  placeholder: 'Available weekends / touring Oct–Dec',
                  help: 'A short note on when you can work. For exact dates, use the Availability calendar.',
                  className: 'md:col-span-2',
                })}
                {numberField('dayRate')}
                <Field id={fieldId('currency')} label="Currency" error={form.errors.currency}>
                  <AppSelect
                    value={f.currency || 'INR'}
                    onValueChange={(v) => set('currency', v)}
                    options={['INR', 'USD', 'EUR', 'GBP']}
                  />
                </Field>
                {numberField('sessionRate')}
                {numberField('showRate')}
              </div>
              <MoreDetails
                className="mt-5"
                label="More rates (optional): hourly and tour day"
                defaultOpen={!!(f.hourlyRate || f.tourDayRate)}
                forceOpen={!!(form.errors.hourlyRate || form.errors.tourDayRate)}
              >
                <div className="grid md:grid-cols-2 gap-5">
                  {numberField('hourlyRate')}
                  {numberField('tourDayRate')}
                </div>
              </MoreDetails>
              {statusLine('rates')}
            </section>

            <section {...sectionProps(links)}>
              {heading(links)}
              <div className="grid md:grid-cols-2 gap-5">
                {textField('website', 'Website', {
                  type: 'url',
                  inputMode: 'url',
                  autoComplete: 'url',
                  placeholder: 'your-site.com',
                  hint: 'We add https:// for you.',
                })}
                {textField('portfolioUrl', 'Primary portfolio / showreel URL', {
                  type: 'url',
                  inputMode: 'url',
                  placeholder: 'youtube.com/…',
                  hint: 'We add https:// for you.',
                  help: 'Your best single link: a showreel, a playlist or a live video. It is the first thing hirers click.',
                })}
                {textField('phone', 'Phone', {
                  type: 'tel',
                  inputMode: 'tel',
                  autoComplete: 'tel',
                  placeholder: '+91 98765 43210',
                  help: 'Only shared with people you have agreed to work with. Never shown publicly.',
                })}
              </div>
              {statusLine('links')}
            </section>

            <section {...sectionProps(verification)}>
              {heading(verification)}
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                  <div>
                    <p className="font-medium">Email</p>
                    <p className="text-sm text-slate-400">Hirers and Verse write to this address.</p>
                  </div>
                  {f.emailVerified ? (
                    <Badge className="bg-sky-500/15 text-sky-300">
                      <MailCheck size={14} className="mr-1" />
                      Email verified
                    </Badge>
                  ) : (
                    <Button type="button" variant="outline" onClick={verifyEmail}>
                      Verify email
                    </Button>
                  )}
                </div>
                <FormError message={emailError} />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                  <div>
                    <p className="font-medium">Professional verification</p>
                    <p className="text-sm text-slate-400">
                      {f.verified
                        ? 'Your work has been checked. The badge shows on your profile and in search.'
                        : pendingSince
                          ? `Sent ${formatWhen(pendingSince)}. Our team reviews every request; you will hear from us by email.`
                          : 'Share one public link that proves your work. Our team reviews it.'}
                    </p>
                  </div>
                  {f.verified ? (
                    <VerifiedBadge className="bg-emerald-500/15 text-emerald-300" />
                  ) : pendingSince ? (
                    <Badge data-testid="verification-pending" className="bg-amber-500/15 text-amber-200">
                      <Clock3 size={14} className="mr-1" />
                      Pending review
                    </Badge>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setVerifying(true)}>
                      <ShieldCheck size={16} className="mr-2" />
                      Request verification
                    </Button>
                  )}
                </div>
                {f.verified && (
                  <div className="space-y-3">
                    {userId && <ShareBadgeSection userId={userId} />}
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <Checkbox
                        checked={f.shareVerificationPublicly !== false}
                        onCheckedChange={(v) => set('shareVerificationPublicly', !!v)}
                      />
                      Announce my verification on The Stage and let others share my badge card
                    </label>
                    {statusLine('verification')}
                  </div>
                )}
              </div>
            </section>

            <FormError message={form.formError} />
            <div className="flex justify-end">
              <Button
                type="submit"
                data-profile-save
                className="min-w-48"
                disabled={saving || !loaded}
                aria-busy={saving}
              >
                <Save aria-hidden="true" size={16} className="mr-2" />
                {saving ? 'Saving…' : loaded ? 'Save career profile' : 'Loading profile…'}
              </Button>
            </div>
          </div>
        </form>
      </main>
      <VerificationRequestDialog open={verifying} onOpenChange={setVerifying} onSubmit={verify} />
      <DebugLinkDialog link={debugLink} onClose={() => setDebugLink(null)} />
      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent data-testid="unsaved-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Some changes on this page have not been saved yet. Save them first, or leave and lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-transparent text-slate-200 hover:bg-white/10"
              onClick={() => blocker.proceed?.()}
            >
              Leave without saving
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void saveAllAndLeave()}>Save and leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
