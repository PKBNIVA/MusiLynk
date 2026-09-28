import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { toast } from 'sonner';
import { ShieldCheck, MailCheck } from 'lucide-react';
import { Checkbox } from '../components/ui/checkbox';
import { DebugLinkDialog, VerificationRequestDialog } from '../components/VerificationDialogs';
import { errorMessage } from '../lib/errors';
import type { AccountUser } from '../lib/apiTypes';
import { Field, FormError } from '../components/form/Field';
import { PHONE_MESSAGE, URL_MESSAGE, isHttpUrl, isPhone, useFormErrors, useSubmitOnce } from '../lib/formErrors';
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
  const [f, setF] = useState<ProfileForm>({}),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    [verifying, setVerifying] = useState(false),
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
      if (form.setErrors(validateProfile(f))) {
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
        if (form.setFromApi(e, 'Your profile could not be saved. Try again.')) form.focusFirst();
      }
    });
  }
  async function verify(evidenceUrl: string) {
    await apiPost('/verification-requests', {
      kind: 'professional',
      evidenceUrl,
      note: 'Professional verification request',
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
    <Field id={fieldId(k)} label={NUMBER_LABELS[k]} error={form.errors[k]}>
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
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
          <div>
            <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Professional identity</div>
            <h1 className="text-4xl font-bold">Build a proof-first music profile</h1>
            <p className="text-slate-400 mt-2">
              Credits, work samples and role-specific context matter more than generic profile completion.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
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
              <Badge className="bg-emerald-500/15 text-emerald-300">
                <ShieldCheck size={14} className="mr-1" />
                Verified professional
              </Badge>
            ) : (
              <Button variant="outline" onClick={() => setVerifying(true)}>
                <ShieldCheck size={16} className="mr-2" />
                Request verification
              </Button>
            )}
          </div>
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
        <form onSubmit={save} className="space-y-5" noValidate>
          <Card className="bg-white/[.055] border-white/10">
            <CardHeader>
              <CardTitle>Positioning</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-5">
              {textField('headline', 'Professional headline', {
                placeholder: 'Playback singer · Vocal producer · Hindi / Punjabi',
              })}
              {textField('location', 'Base location', {
                placeholder: 'Mumbai, Maharashtra',
                autoComplete: 'address-level2',
              })}
              {textField('experience', 'Experience', { placeholder: '5 years / 30+ sessions / emerging' })}
              {textField('availability', 'Availability', { placeholder: 'Available weekends / touring Oct–Dec' })}
              <Field
                id={fieldId('bio')}
                label="Bio"
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
            </CardContent>
          </Card>
          <Card className="bg-white/[.055] border-white/10">
            <CardHeader>
              <CardTitle>Music-specific signals</CardTitle>
              <p className="text-xs text-slate-500">Separate several entries with commas.</p>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-5">
              {textField('skills', 'Skills', { placeholder: 'Mixing, toplining, vocal production' })}
              {textField('genres', 'Genres', { placeholder: 'Bollywood, Indie Pop, Hip-Hop' })}
              {textField('instruments', 'Instruments / voice', { placeholder: 'Vocals, guitar, keys' })}
              {textField('languages', 'Languages', { placeholder: 'Hindi, English, Punjabi' })}
              {textField('openTo', 'Open to', {
                placeholder: 'Sessions, touring, full-time, sync, collaborations',
                className: 'md:col-span-2',
              })}
              {textField('roles', 'Professional roles', {
                placeholder: 'Session Bassist, Musical Director, FOH Engineer',
              })}
              {textField('gear', 'Gear / consoles / instruments', {
                placeholder: 'Fender Jazz V, DiGiCo Quantum, IEM rig',
              })}
              {textField('software', 'Software / DAWs', { placeholder: 'Pro Tools, Logic Pro, Ableton Live' })}
              {numberField('yearsExperience')}
              <div className="md:col-span-2 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm text-slate-300">
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
                  <Checkbox checked={!!f.travelsNationally} onCheckedChange={(v) => set('travelsNationally', !!v)} />
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
              <Field
                id={fieldId('credits')}
                label="Selected credits"
                hint="One per line."
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
            </CardContent>
          </Card>
          <Card className="bg-white/[.055] border-white/10">
            <CardHeader>
              <CardTitle>Links & commercial details</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-5">
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
              })}
              {numberField('hourlyRate')}
              {numberField('sessionRate')}
              {numberField('showRate')}
              {numberField('tourDayRate')}
              {numberField('dayRate')}
              <Field id={fieldId('currency')} label="Currency" error={form.errors.currency}>
                <select
                  value={f.currency || 'INR'}
                  onChange={(e) => set('currency', e.target.value)}
                  className="w-full h-10 rounded-md bg-slate-900 border border-white/15 px-3"
                >
                  {['INR', 'USD', 'EUR', 'GBP'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              {textField('phone', 'Phone', {
                type: 'tel',
                inputMode: 'tel',
                autoComplete: 'tel',
                placeholder: '+91 98765 43210',
              })}
            </CardContent>
          </Card>
          <FormError message={form.formError} />
          <Button type="submit" className="w-full" disabled={saving || !loaded} aria-busy={saving}>
            {saving ? 'Saving…' : loaded ? 'Save career profile' : 'Loading profile…'}
          </Button>
        </form>
      </main>
      <VerificationRequestDialog open={verifying} onOpenChange={setVerifying} onSubmit={verify} />
      <DebugLinkDialog link={debugLink} onClose={() => setDebugLink(null)} />
    </div>
  );
}
