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
import { ShieldCheck } from 'lucide-react';
import { FormDialog, fieldClass } from '../components/HiringDialog';
import { errorMessage } from '../lib/errors';
import type { AccountUser } from '../lib/apiTypes';
import { Field, FormError, RequiredNote } from '../components/form/Field';
import { PHONE_MESSAGE, URL_MESSAGE, isHttpUrl, isPhone, useFormErrors, useSubmitOnce } from '../lib/formErrors';

type OrgField = 'companyName' | 'companyWebsite' | 'companySize' | 'phone' | 'location' | 'companyDescription';
const ORG_IDS: Record<OrgField, string> = {
  companyName: 'org-companyName',
  companyWebsite: 'org-companyWebsite',
  companySize: 'org-companySize',
  phone: 'org-phone',
  location: 'org-location',
  companyDescription: 'org-description',
};
const DESCRIPTION_MAX = 2_000;

/** Client-side checks that mirror the API (profiles#update and the Profile model). */
function validateOrganization(f: Partial<AccountUser>) {
  const errors: Partial<Record<OrgField, string>> = {};
  if (!f.companyName?.trim()) errors.companyName = 'Enter your company, label or studio name.';
  if (f.companyWebsite?.trim() && !isHttpUrl(f.companyWebsite)) errors.companyWebsite = URL_MESSAGE;
  if (f.phone?.trim() && !isPhone(f.phone)) errors.phone = PHONE_MESSAGE;
  if ((f.companyDescription?.length ?? 0) > DESCRIPTION_MAX)
    errors.companyDescription = `Keep the description under ${DESCRIPTION_MAX.toLocaleString()} characters.`;
  return errors;
}

export default function CompanyProfile() {
  const { setUser } = useAuth();
  const form = useFormErrors<OrgField>({ ids: ORG_IDS });
  const submit = useSubmitOnce();
  const saving = submit.busy;
  const [f, setF] = useState<Partial<AccountUser>>({}),
    [loadError, setLoadError] = useState(''),
    [verifyError, setVerifyError] = useState(''),
    [verifyOpen, setVerifyOpen] = useState(false),
    [evidenceUrl, setEvidenceUrl] = useState(''),
    [verifyBusy, setVerifyBusy] = useState(false),
    [requested, setRequested] = useState(false);
  const loadMe = () =>
    apiGet<{ user?: AccountUser }>('/me')
      .then(({ user }) => {
        setF(user || {});
        setLoadError('');
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'Your organization profile could not be loaded.')));
  useEffect(() => {
    loadMe();
  }, []);
  const set = (k: OrgField, v: string) => {
    setF((current) => ({ ...current, [k]: v }));
    form.clear(k);
  };
  function save(e: React.FormEvent) {
    e.preventDefault();
    void submit.run(async () => {
      form.setFormError('');
      if (form.setErrors(validateOrganization(f))) {
        form.focusFirst();
        return;
      }
      try {
        const d = await apiPut<{ user: AccountUser }>('/profile', {
          ...f,
          companyName: f.companyName?.trim() ?? '',
        });
        setUser(d.user);
        setF((current) => ({ ...current, ...d.user }));
        toast.success('Organization profile saved');
      } catch (e: unknown) {
        if (form.setFromApi(e, 'Your organization profile could not be saved. Try again.')) form.focusFirst();
      }
    });
  }
  const validEvidence = (v: string) => {
    try {
      const u = new URL(v.trim());
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };
  async function verify() {
    if (!validEvidence(evidenceUrl)) {
      setVerifyError('Enter a full website address starting with https://');
      document.getElementById('verification-evidence')?.focus();
      return;
    }
    setVerifyError('');
    setVerifyBusy(true);
    try {
      await apiPost('/verification-requests', {
        kind: 'organization',
        evidenceUrl: evidenceUrl.trim(),
        note: 'Organization verification request',
      });
      toast.success('Verification request submitted');
      setRequested(true);
      setVerifyOpen(false);
    } catch (e: unknown) {
      setVerifyError(errorMessage(e, 'Your verification request could not be sent. Try again.'));
    } finally {
      setVerifyBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
          <div>
            <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Organization identity</div>
            <h1 className="text-4xl font-bold">Employer trust profile</h1>
            <p className="text-slate-400 mt-2">
              Candidates should know who is hiring, where the work happens and whether the organization is verified.
            </p>
          </div>
          {f.verified ? (
            <Badge className="bg-emerald-500/15 text-emerald-300">
              <ShieldCheck size={14} className="mr-1" />
              Verified organization
            </Badge>
          ) : (
            <Button
              variant="outline"
              disabled={requested}
              onClick={() => {
                setEvidenceUrl(f.companyWebsite || '');
                setVerifyError('');
                setVerifyOpen(true);
              }}
            >
              <ShieldCheck size={16} className="mr-2" />
              {requested ? 'Verification requested' : 'Request verification'}
            </Button>
          )}
        </div>
        {loadError && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex flex-wrap items-center justify-between gap-3"
          >
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={loadMe}>
              Try again
            </Button>
          </div>
        )}
        <form onSubmit={save} noValidate>
          <Card className="bg-white/[.055] border-white/10">
            <CardHeader>
              <CardTitle>Organization details</CardTitle>
              <RequiredNote className="mt-1" />
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-5">
              <Field
                id={ORG_IDS.companyName}
                label="Company / label / studio name"
                required
                error={form.errors.companyName}
              >
                <Input
                  value={f.companyName || ''}
                  onChange={(e) => set('companyName', e.target.value)}
                  autoComplete="organization"
                  maxLength={120}
                  className="bg-black/20 border-white/15"
                />
              </Field>
              <Field
                id={ORG_IDS.companyWebsite}
                label="Official website"
                hint="Include https://"
                error={form.errors.companyWebsite}
              >
                <Input
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://your-label.com"
                  value={f.companyWebsite || ''}
                  onChange={(e) => set('companyWebsite', e.target.value)}
                  maxLength={500}
                  className="bg-black/20 border-white/15"
                />
              </Field>
              <Field id={ORG_IDS.companySize} label="Team size" error={form.errors.companySize}>
                <Input
                  value={f.companySize || ''}
                  onChange={(e) => set('companySize', e.target.value)}
                  placeholder="e.g. 11-50"
                  maxLength={60}
                  className="bg-black/20 border-white/15"
                />
              </Field>
              <Field id={ORG_IDS.phone} label="Contact phone" error={form.errors.phone}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={f.phone || ''}
                  onChange={(e) => set('phone', e.target.value)}
                  maxLength={20}
                  className="bg-black/20 border-white/15"
                />
              </Field>
              <Field id={ORG_IDS.location} label="Primary location" error={form.errors.location}>
                <Input
                  value={f.location || ''}
                  onChange={(e) => set('location', e.target.value)}
                  autoComplete="address-level2"
                  maxLength={120}
                  className="bg-black/20 border-white/15"
                />
              </Field>
              <Field
                id={ORG_IDS.companyDescription}
                label="What your organization does"
                className="md:col-span-2"
                error={form.errors.companyDescription}
                count={(f.companyDescription || '').length}
                maxLength={DESCRIPTION_MAX}
              >
                <Textarea
                  value={f.companyDescription || ''}
                  onChange={(e) => set('companyDescription', e.target.value)}
                  placeholder="Describe your label, studio, management company, venue, festival, production house or music-tech business. Include the kinds of teams and projects you hire for."
                  className="bg-black/20 border-white/15 min-h-40 [overflow-wrap:anywhere]"
                />
              </Field>
            </CardContent>
          </Card>
          <FormError message={form.formError} className="mt-4" />
          <Button type="submit" className="mt-5 w-full" disabled={saving || !!loadError} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save organization profile'}
          </Button>
        </form>
        <FormDialog
          open={verifyOpen}
          onOpenChange={setVerifyOpen}
          title="Request organization verification"
          description="Share your official website or another public source that proves this organization. Our team reviews every request."
          submitLabel="Submit request"
          busy={verifyBusy}
          submitDisabled={!evidenceUrl.trim()}
          onSubmit={verify}
        >
          <Field id="verification-evidence" label="Evidence link" required error={verifyError}>
            <input
              type="url"
              inputMode="url"
              placeholder="https://your-label.com/about"
              value={evidenceUrl}
              onChange={(e) => {
                setEvidenceUrl(e.target.value);
                setVerifyError('');
              }}
              className={fieldClass}
            />
          </Field>
        </FormDialog>
      </main>
    </div>
  );
}
