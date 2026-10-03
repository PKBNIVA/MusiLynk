import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, KeyRound, Link2, Mic2, Sparkles } from 'lucide-react';
import { usePageMeta } from '../components/PageMeta';
import { PUBLIC_PAGE_META } from '../lib/siteMeta';
import { SkipLink } from '../components/SkipLink';
import { BrandMark } from '../components/BrandMark';
import { StepForm, focusStepHeading, type FormStep } from '../components/help/StepForm';
import { AutocompleteInput } from '../components/ai/AutocompleteInput';
import { Field } from '../components/form/Field';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { ChoiceChips } from '../components/join/ChoiceChips';
import { WorkLinks, type WorkLink } from '../components/join/WorkLinks';
import { DraftingSkeleton } from '../components/join/DraftingSkeleton';
import { AccountStep } from '../components/join/AccountStep';
import { useAuth, type User } from '../lib/authContext';
import { consumeReturnTo } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { submitUrgentDraft } from '../lib/urgentDraft';
import { trackProfileLinkAdded, trackSignupStep } from '../lib/analytics';
import { toast } from 'sonner';
import {
  DEFAULT_CITY,
  HIRER_KINDS,
  MUSICIAN_ROLES,
  ROLE_MAX_LENGTH,
  starterLinks,
  type HirerKind,
  type StarterPayload,
} from '../lib/onboarding';
import { buildBio, buildHeadline, yearsOf } from '../lib/profileTemplates';
import { draftFromLinks, type DraftResult, type ProfileDraft } from '../lib/linkImport';

const ProfileDraftReview = lazy(() => import('../components/join/ProfileDraftReview'));

/**
 * True once per document when this page load is the "Continue with Google" round trip
 * (GoogleAuthController sends a new account to /join/<role>?auth=google&code=...). authContext
 * strips those params from the URL as soon as it mounts, before this lazy page renders, so the
 * document's original navigation URL is read as well. Read once and cleared by
 * `markGoogleSignupTracked`, so it fires exactly once per Google sign-up.
 */
let googleReturnPending: boolean | null = null;
function googleReturnIsPending(): boolean {
  if (googleReturnPending === null) {
    googleReturnPending = false;
    try {
      const fromUrl = (search: string) => {
        const params = new URLSearchParams(search);
        return params.get('auth') === 'google' && Boolean(params.get('code'));
      };
      const entry = performance.getEntriesByType('navigation')[0];
      googleReturnPending = fromUrl(window.location.search) || (entry ? fromUrl(new URL(entry.name).search) : false);
    } catch {
      /* no Performance API: leave it false */
    }
  }
  return googleReturnPending;
}

/**
 * The two-minute sign-up. Musicians: what you do and where, links to your work, then an
 * account. Hirers: what you are and where, then an account. "Complete my profile later" skips
 * straight to the account on any step; the full profile wizard stays for later.
 */
export default function Join() {
  const { audience } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Set once this page starts creating an account, so the signed-in redirect below never races
  // the page's own "welcome" navigation.
  const creating = useRef(false);
  // A Google sign-up creates the account on the server and comes back signed in, so `finish`
  // never runs; count it here once the session resolves.
  useEffect(() => {
    if (!user || creating.current || !googleReturnIsPending()) return;
    googleReturnPending = false;
    trackSignupStep('completed', { role: user.role, method: 'google' });
  }, [user]);
  if (audience !== 'musician' && audience !== 'hiring') return <Navigate to="/join/musician" replace />;
  if (user && !creating.current)
    return <Navigate to={`/${user.role === 'employer' ? 'employer' : 'jobseeker'}`} replace />;

  const finish = async (created: User) => {
    trackSignupStep('completed', { role: created.role });
    // A hirer who came from /urgent has a draft waiting: post it and show the status card.
    try {
      const confirmed = await submitUrgentDraft();
      if (confirmed) {
        navigate('/urgent', { replace: true, state: { confirmed } });
        return;
      }
    } catch {
      toast.error('Your account is ready, but the urgent request could not be posted. Please try again from /urgent.');
    }
    const requested = (location.state as { from?: unknown } | null)?.from ?? consumeReturnTo();
    const home = created.role === 'employer' ? 'employer' : 'jobseeker';
    // A bandmate invite link is role-neutral, so signing up from one lands back on the invite.
    const allowed =
      typeof requested === 'string' && (requested.startsWith(`/${home}`) || /^\/invites\/[\w-]+$/.test(requested));
    navigate(allowed ? requested : `/${home}?welcome=1`, { replace: true });
  };
  const onStart = () => {
    creating.current = true;
  };
  return audience === 'musician' ? (
    <MusicianJoin onStart={onStart} onDone={finish} />
  ) : (
    <HirerJoin onStart={onStart} onDone={finish} />
  );
}

function JoinShell({
  title,
  intro,
  signInRole,
  other,
  children,
}: {
  title: string;
  intro: string;
  signInRole: 'jobseeker' | 'employer';
  other: ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <SkipLink />
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" aria-label="MusiLynk home" className="inline-flex min-h-11 items-center rounded-xl">
          <BrandMark compact />
        </Link>
        <p className="text-sm text-slate-300">
          On MusiLynk already?{' '}
          <Link
            to={`/auth/${signInRole}`}
            state={location.state}
            className="font-semibold text-white underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-2 sm:px-6 sm:pt-6">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-slate-300">{intro}</p>
        <div className="musilynk-surface mt-6 rounded-3xl p-5 sm:p-7">{children}</div>
        <p className="mt-6 text-center text-sm text-slate-400">{other}</p>
      </main>
    </div>
  );
}

/** Back, "Complete my profile later" and Next, under each answer step. */
function StepActions({ onBack, onLater, nextLabel }: { onBack?: () => void; onLater: () => void; nextLabel: string }) {
  return (
    <div className="mt-7 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center">
      {onBack && (
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Back
        </Button>
      )}
      <button
        type="button"
        onClick={onLater}
        className="min-h-11 text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline sm:ml-auto"
      >
        Complete my profile later
      </button>
      <Button type="submit" className="min-w-36 bg-violet-600 text-white hover:bg-violet-500">
        {nextLabel}
        <ArrowRight aria-hidden="true" size={16} />
      </Button>
    </div>
  );
}

/** Fires `signup_started` once when a join flow shows its first step. */
function useSignupStarted(role: 'jobseeker' | 'employer') {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // A Google return is the tail of a sign-up already started on this page load's predecessor.
    if (googleReturnIsPending()) return;
    trackSignupStep('started', { role });
  }, [role]);
}

function useSteps(ids: readonly string[]) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const goTo = (index: number) => {
    flushSync(() => {
      setStep(index);
      setReached((current) => Math.max(current, index));
    });
    focusStepHeading(ids[index]);
  };
  return { step, reached, goTo };
}

// ---- Musicians and crew ----------------------------------------------------------------------

const MUSICIAN_STEPS = ['you', 'work', 'account'] as const;

function MusicianJoin({ onStart, onDone }: { onStart: () => void; onDone: (user: User) => void }) {
  usePageMeta(PUBLIC_PAGE_META['/join/musician'].title, PUBLIC_PAGE_META['/join/musician'].description, {
    canonicalPath: '/join/musician',
  });
  useSignupStarted('jobseeker');
  const { step, reached, goTo } = useSteps(MUSICIAN_STEPS);
  const [roles, setRoles] = useState<string[]>([]);
  const [otherRoles, setOtherRoles] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([DEFAULT_CITY]);
  const [links, setLinks] = useState<WorkLink[]>([]);
  const [years, setYears] = useState('');
  const [errors, setErrors] = useState<{ roles?: string; city?: string; years?: string }>({});
  // "Draft my profile from these links": drafting is the in-flight request; draftResult is the
  // review card's data once it answers; appliedDraft is what "Use this" left behind (headline,
  // bio, genres, instruments and credits — the rest is folded straight into roles/city/years/
  // captions above). Nothing here is saved until the account is actually created.
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [appliedDraft, setAppliedDraft] = useState<ProfileDraft | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const allRoles = [...roles, ...otherRoles.filter((role) => !roles.includes(role))];
  const facts = { roles: allRoles, city: city[0], years };

  const runDraft = async () => {
    setDrafting(true);
    try {
      setDraftResult(
        await draftFromLinks(
          links.map((link) => link.url),
          { roles: allRoles, city: city[0] },
        ),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, 'Couldn’t draft a profile from those links. Try again.'));
    } finally {
      setDrafting(false);
    }
  };
  const useDraft = (draft: ProfileDraft) => {
    setAppliedDraft(draft);
    if (draft.roles.length) setOtherRoles((current) => Array.from(new Set([...current, ...draft.roles])));
    if (draft.city) setCity([draft.city]);
    if (draft.yearsExperience != null) setYears(String(draft.yearsExperience));
    const nextCaptions: Record<string, string> = {};
    draft.items.forEach((item) => {
      if (item.caption) nextCaptions[item.url] = item.caption;
    });
    setCaptions(nextCaptions);
    setDraftResult(null);
  };

  const starter = (): StarterPayload => {
    const yearsValue = yearsOf(years);
    return {
      roles: allRoles,
      genres: appliedDraft?.genres ?? [],
      instruments: appliedDraft?.instruments ?? [],
      credits: appliedDraft?.credits ?? [],
      city: city[0],
      ...(yearsValue === null ? {} : { yearsExperience: yearsValue }),
      headline: appliedDraft?.headline || buildHeadline(facts),
      bio: appliedDraft?.bio || buildBio(facts),
      links: starterLinks(
        links.map((link) => link.preview),
        captions,
      ),
    };
  };

  const nextFromYou = (event: React.FormEvent) => {
    event.preventDefault();
    const next = {
      roles: allRoles.length ? undefined : 'Pick at least one, or choose “Complete my profile later”.',
      city: city[0]?.trim() ? undefined : 'Tell us the city you work from.',
    };
    setErrors(next);
    if (next.roles) return document.getElementById('join-roles')?.focus();
    if (next.city) return document.getElementById('join-city')?.focus();
    goTo(1);
  };
  const nextFromWork = (event: React.FormEvent) => {
    event.preventDefault();
    if (years.trim() && yearsOf(years) === null) {
      setErrors({ years: 'Enter a whole number of years, from 0 to 80.' });
      return document.getElementById('join-years')?.focus();
    }
    setErrors({});
    goTo(2);
  };
  const later = () => goTo(2);
  const headline = appliedDraft?.headline || buildHeadline(facts);

  const steps: FormStep[] = [
    {
      id: MUSICIAN_STEPS[0],
      title: 'What you do',
      icon: Mic2,
      description: 'So hirers find you for the right work.',
      content: (
        <form onSubmit={nextFromYou} noValidate className="space-y-6">
          <ChoiceChips
            id="join-roles"
            legend="Your roles"
            hint="Pick all that fit."
            options={MUSICIAN_ROLES}
            selected={roles}
            onChange={(next) => {
              setRoles(next);
              setErrors((current) => ({ ...current, roles: undefined }));
            }}
            error={errors.roles}
          />
          <AutocompleteInput
            id="join-other-role"
            field="roles"
            label="Something else? Add it here"
            maxLength={ROLE_MAX_LENGTH}
            values={otherRoles}
            onChange={(next) => {
              setOtherRoles(next);
              setErrors((current) => ({ ...current, roles: undefined }));
            }}
            placeholder="Sarangi player, arranger, backing vocalist…"
          />
          <div>
            <AutocompleteInput
              id="join-city"
              field="cities"
              label="City you work from"
              multiple={false}
              values={city}
              onChange={(next) => {
                setCity(next);
                setErrors((current) => ({ ...current, city: undefined }));
              }}
              placeholder="Type to change the city"
            />
            {errors.city && (
              <p role="alert" className="mt-1.5 text-sm text-rose-300">
                {errors.city}
              </p>
            )}
          </div>
          <StepActions onLater={later} nextLabel="Next: your work" />
        </form>
      ),
    },
    {
      id: MUSICIAN_STEPS[1],
      title: 'Your work',
      icon: Link2,
      description: 'Links become your starter portfolio. Hirers listen before they book.',
      content: (
        <form onSubmit={nextFromWork} noValidate className="space-y-6">
          <WorkLinks links={links} onChange={setLinks} />
          {links.length > 0 && !draftResult && (
            <Button
              type="button"
              variant="outline"
              onClick={runDraft}
              disabled={drafting}
              className="border-violet-400/40 text-violet-100"
            >
              <Sparkles aria-hidden="true" size={16} />
              Draft my profile from these links
            </Button>
          )}
          {drafting && <DraftingSkeleton />}
          {draftResult && (
            <Suspense fallback={<DraftingSkeleton />}>
              <ProfileDraftReview result={draftResult} onUse={useDraft} onSkip={() => setDraftResult(null)} />
            </Suspense>
          )}
          <Field id="join-years" label="Years of experience" optional error={errors.years} className="max-w-48">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={80}
              step={1}
              value={years}
              onChange={(event) => {
                setYears(event.target.value);
                setErrors({});
              }}
              className="border-white/15 bg-black/20"
            />
          </Field>
          {headline && (
            <p
              className="rounded-2xl border border-white/10 bg-white/[.03] p-4 text-sm text-slate-300"
              data-testid="headline-preview"
            >
              Your profile will start with the headline <span className="font-semibold text-white">“{headline}”</span>.
              You can change it any time.
            </p>
          )}
          <StepActions onBack={() => goTo(0)} onLater={later} nextLabel="Next: your account" />
        </form>
      ),
    },
    {
      id: MUSICIAN_STEPS[2],
      title: 'Your account',
      icon: KeyRound,
      description: 'Last step. Free for musicians and crew.',
      content: (
        <div>
          <AccountStep
            role="jobseeker"
            starter={starter}
            onBegin={onStart}
            onDone={(created) => {
              // The links pasted on this page are saved with the account.
              links.forEach((link) => trackProfileLinkAdded(link.preview.provider));
              onDone(created);
            }}
          />
          <Button type="button" variant="ghost" className="mt-2" onClick={() => goTo(1)}>
            <ArrowLeft aria-hidden="true" size={16} />
            Back
          </Button>
        </div>
      ),
    },
  ];

  return (
    <JoinShell
      title="Join as a musician or crew"
      intro="About two minutes. You can finish your profile later."
      signInRole="jobseeker"
      other={
        <>
          Hiring instead?{' '}
          <Link to="/join/hiring" className="font-semibold text-slate-200 underline underline-offset-4">
            Join as a hirer
          </Link>
        </>
      }
    >
      <StepForm steps={steps} current={step} reached={reached} onStepChange={goTo} />
    </JoinShell>
  );
}

// ---- Hirers --------------------------------------------------------------------------------------

/** What each kind of hirer is looking for, in the words of the choice they make. */
const HIRING_FOR: Record<HirerKind, string> = {
  studio: 'Studio sessions',
  event_company: 'Weddings and events',
  band: 'My band or act',
  label: 'Music releases',
  venue: 'Venue shows',
  other: 'Something else',
};

/**
 * One screen: organisation, city, what you hire for and email (then Terms and the button), with
 * the name and the choice of a password under "More". The account is created from here; the
 * answers become the organisation's Page.
 */
function HirerJoin({ onStart, onDone }: { onStart: () => void; onDone: (user: User) => void }) {
  usePageMeta(PUBLIC_PAGE_META['/join/hiring'].title, PUBLIC_PAGE_META['/join/hiring'].description, {
    canonicalPath: '/join/hiring',
  });
  useSignupStarted('employer');
  const [kind, setKind] = useState<HirerKind | ''>('');
  const [city, setCity] = useState<string[]>([DEFAULT_CITY]);
  const [company, setCompany] = useState('');
  const [errors, setErrors] = useState<{ company?: string; kind?: string; city?: string }>({});

  // The three answers this screen asks for, all needed before an account is made.
  const validateLead = () => {
    const found = {
      company: company.trim()
        ? undefined
        : 'Enter the name musicians will see: a studio, company, band or your own name.',
      city: city[0]?.trim() ? undefined : 'Tell us the city you hire in.',
      kind: kind ? undefined : 'Choose what you hire for.',
    };
    setErrors(found);
    if (found.company) document.getElementById('join-company')?.focus();
    else if (found.city) document.getElementById('join-hire-city')?.focus();
    else if (found.kind) document.querySelector<HTMLInputElement>('input[name="hirer-kind"]')?.focus();
    return !found.company && !found.city && !found.kind;
  };
  const starter = (): StarterPayload => ({
    ...(kind ? { hirerKind: kind } : {}),
    city: city[0],
    companyName: company,
  });

  const lead = (
    <>
      <Field
        id="join-company"
        label="Organisation or team name"
        error={errors.company}
        hint="We’ll create its Page on MusiLynk, so you can post work as it."
      >
        <Input
          autoComplete="organization"
          value={company}
          maxLength={120}
          onChange={(event) => {
            setCompany(event.target.value);
            setErrors((current) => ({ ...current, company: undefined }));
          }}
          className="border-white/15 bg-black/20"
        />
      </Field>
      <div>
        <AutocompleteInput
          id="join-hire-city"
          field="cities"
          label="City you hire in"
          multiple={false}
          values={city}
          onChange={(value) => {
            setCity(value);
            setErrors((current) => ({ ...current, city: undefined }));
          }}
          placeholder="Type to change the city"
        />
        {errors.city && (
          <p role="alert" className="mt-1.5 text-sm text-rose-300">
            {errors.city}
          </p>
        )}
      </div>
      <fieldset aria-describedby={errors.kind ? 'join-kind-error' : undefined}>
        <legend className="text-sm font-medium text-slate-200">What do you hire for?</legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {HIRER_KINDS.map((option) => (
            <label
              key={option.value}
              className="relative flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-white/15 bg-white/[.03] px-3 text-sm leading-tight text-slate-100 hover:border-white/30 has-[:checked]:border-violet-300/70 has-[:checked]:bg-violet-500/20 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet-300"
            >
              <input
                type="radio"
                name="hirer-kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => {
                  setKind(option.value);
                  setErrors((current) => ({ ...current, kind: undefined }));
                }}
                className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 focus-visible:outline-none"
              />
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-full border-2 border-slate-400 peer-checked:border-violet-400 peer-checked:bg-violet-400 peer-checked:shadow-[inset_0_0_0_2px_rgb(30_27_75)] forced-colors:border-[CanvasText] forced-colors:peer-checked:bg-[Highlight] forced-colors:peer-checked:shadow-[inset_0_0_0_2px_Canvas]"
              />
              {HIRING_FOR[option.value]}
            </label>
          ))}
        </div>
        {errors.kind && (
          <p id="join-kind-error" role="alert" className="mt-2 text-sm text-rose-300">
            {errors.kind}
          </p>
        )}
      </fieldset>
    </>
  );

  return (
    <JoinShell
      title="Join to hire musicians and crew"
      intro="About a minute. Posting a request is free."
      signInRole="employer"
      other={
        <>
          Are you a musician or crew?{' '}
          <Link to="/join/musician" className="font-semibold text-slate-200 underline underline-offset-4">
            Join as a musician
          </Link>
        </>
      }
    >
      <AccountStep
        role="employer"
        compact
        lead={lead}
        validateLead={validateLead}
        fallbackName={() => company}
        starter={starter}
        onBegin={onStart}
        onDone={onDone}
      />
    </JoinShell>
  );
}
