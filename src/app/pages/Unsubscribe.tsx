import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MailX } from 'lucide-react';
import { PublicNav } from '../components/PublicNav';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { apiGet, apiPatch } from '../lib/api';
import { errorStatus } from '../lib/errors';
import { usePageMeta } from '../components/PageMeta';

type State = 'loading' | 'ready' | 'invalid' | 'error';
type Category = 'digest' | 'lifecycle' | 'requests' | 'product';

const CATEGORY_LABELS: Record<Category, { label: string; hint: string }> = {
  digest: {
    label: 'Weekly digest',
    hint: 'Requests and jobs near you, profile views, and what is new — every Tuesday.',
  },
  lifecycle: {
    label: 'Getting started tips',
    hint: 'A few emails while you set up your profile or first opportunity.',
  },
  requests: { label: 'Urgent requests', hint: 'Alerts about urgent requests near you.' },
  product: { label: 'Milestones', hint: 'A note when you hit a milestone, like your first application.' },
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

type Preferences = Record<Category, boolean>;

/** Target of the "Manage emails" link in every lifecycle, digest and milestone email, and of
 * the older "Turn off these emails" link in transactional emails. No sign-in required: the
 * signed token (same one NotificationEmail issues) names the account. */
export default function Unsubscribe() {
  usePageMeta('Unsubscribe', 'Turn off MusiLynk notification emails.', { noindex: true });
  const [search] = useSearchParams();
  const token = search.get('token') || '';
  const [state, setState] = useState<State>(token ? 'loading' : 'invalid');
  const [master, setMaster] = useState(true);
  const [preferences, setPreferences] = useState<Preferences>({
    digest: true,
    lifecycle: true,
    requests: true,
    product: true,
  });
  const [saving, setSaving] = useState<Category | 'master' | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await apiGet<{ emailNotifications: boolean; emailPreferences: Preferences }>(
        `/notifications/unsubscribe/preferences?token=${encodeURIComponent(token)}`,
        { skipAuthRedirect: true },
      );
      setMaster(data.emailNotifications);
      setPreferences({ ...preferences, ...data.emailPreferences });
      setState('ready');
    } catch (e: unknown) {
      setState(errorStatus(e) === 400 ? 'invalid' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const saveMaster = useCallback(
    async (value: boolean) => {
      setSaving('master');
      setMaster(value);
      try {
        await apiPatch(
          `/notifications/unsubscribe/preferences`,
          { token, emailNotifications: value },
          { skipAuthRedirect: true },
        );
      } catch {
        setMaster(!value);
      } finally {
        setSaving(null);
      }
    },
    [token],
  );

  const saveCategory = useCallback(
    async (category: Category, value: boolean) => {
      setSaving(category);
      const next = { ...preferences, [category]: value };
      setPreferences(next);
      try {
        await apiPatch(
          `/notifications/unsubscribe/preferences`,
          { token, emailPreferences: { [category]: value } },
          { skipAuthRedirect: true },
        );
      } catch {
        setPreferences(preferences);
      } finally {
        setSaving(null);
      }
    },
    [token, preferences],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-lg mx-auto px-5 py-24">
        <div className="text-center">
          <MailX className="mx-auto text-violet-300" size={36} aria-hidden="true" />
          <h1 className="text-3xl font-bold mt-4">Manage your MusiLynk emails</h1>
        </div>
        <div
          className="mt-4 text-slate-300 text-center"
          role={state === 'loading' ? 'status' : 'alert'}
          data-testid="unsubscribe-status"
        >
          {state === 'loading' && 'Loading your email preferences…'}
          {state === 'invalid' &&
            'This link is invalid or incomplete. You can change your email preferences from Notifications after signing in.'}
          {state === 'error' && 'We couldn’t load your preferences right now. Please try again.'}
        </div>
        {state === 'error' && (
          <div className="mt-4 flex justify-center">
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        )}
        {state === 'ready' && (
          <div className="mt-8 space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 p-4">
              <div>
                <div className="font-semibold">All MusiLynk emails</div>
                <div className="text-sm text-slate-400">
                  Turn this off to stop every category below. Sign-in codes, verification and security emails still
                  arrive.
                </div>
              </div>
              <Switch
                checked={master}
                disabled={saving === 'master'}
                onCheckedChange={(value) => void saveMaster(value)}
                aria-label="All MusiLynk emails"
                data-testid="toggle-master"
              />
            </div>
            {CATEGORIES.map((category) => (
              <div
                key={category}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 p-4"
              >
                <div>
                  <div className="font-semibold">{CATEGORY_LABELS[category].label}</div>
                  <div className="text-sm text-slate-400">{CATEGORY_LABELS[category].hint}</div>
                </div>
                <Switch
                  checked={master && preferences[category]}
                  disabled={!master || saving === category}
                  onCheckedChange={(value) => void saveCategory(category, value)}
                  aria-label={CATEGORY_LABELS[category].label}
                  data-testid={`toggle-${category}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button variant="outline" asChild>
            <Link to="/auth/jobseeker">Sign in to MusiLynk</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
