import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { apiGet, apiPost } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Field } from '../components/form/Field';
import { WandSparkles, Users, ArrowRight, ListChecks, PartyPopper } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/authContext';
import { errorMessage } from '../lib/errors';
import type { CrewPlan } from '../lib/apiTypes';
import { FormSection, MoreDetails } from '../components/help/MoreDetails';
import { AppSelect } from '../components/ui/app-select';
import { formatInputEcho } from '../lib/format';
import { optionLabel } from '../components/ui/option-labels';
const needOptions = ['music', 'sound', 'lighting', 'video', 'production'];
export default function BuildMyCrew() {
  const [plans, setPlans] = useState<CrewPlan[]>([]),
    [f, setF] = useState<{
      title: string;
      eventType: string;
      city: string;
      eventDate: string;
      audienceSize: number | string;
      budget: string;
      currency: string;
      genres: string;
      needs: string[];
      notes: string;
    }>({
      title: '',
      eventType: 'Corporate event',
      city: '',
      eventDate: '',
      audienceSize: 300,
      budget: '',
      currency: 'INR',
      genres: 'Bollywood, Pop',
      needs: ['music', 'sound', 'production'],
      notes: '',
    });
  const nav = useNavigate(),
    { user } = useAuth(),
    bandBuilder = user?.role === 'jobseeker' ? '/jobseeker/band-builder' : '/employer/band-builder';
  const [loading, setLoading] = useState(true),
    [createError, setCreateError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [busy, setBusy] = useState(''),
    [converted, setConverted] = useState<Record<string, boolean>>({});
  const load = () =>
    apiGet<{ plans?: CrewPlan[] }>('/crew-plans')
      .then((d) => {
        setPlans(d.plans || []);
        setLoadError('');
      })
      .catch((e: unknown) => setLoadError(errorMessage(e, 'Crew plans could not be loaded.')))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);
  const toggle = (x: string) =>
    setF({ ...f, needs: f.needs.includes(x) ? f.needs.filter((y: string) => y !== x) : [...f.needs, x] });
  async function create() {
    if (busy) return;
    if (!f.title.trim() || !f.city.trim()) {
      setCreateError('Add an event name and city.');
      return;
    }
    setBusy('create');
    try {
      await apiPost('/crew-plans', {
        ...f,
        audienceSize: Number(f.audienceSize) || 0,
        budget: f.budget ? Number(f.budget) : null,
        genres: f.genres
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
      });
      setCreateError('');
      toast.success('Crew plan created');
      setF({ ...f, title: '' });
      await load();
    } catch (e: unknown) {
      setCreateError(errorMessage(e, 'The crew plan could not be created. Try again.'));
    } finally {
      setBusy('');
    }
  }
  async function convert(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await apiPost(`/crew-plans/${id}/convert`, {});
      setConverted((x) => ({ ...x, [id]: true }));
      toast.success('Moved to Band Builder. Publish each opening from there.', {
        action: { label: 'Open Band Builder', onClick: () => nav(bandBuilder) },
      });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader title="Build my crew" />
        <div className="grid lg:grid-cols-[.8fr_1.2fr] gap-6 mt-8">
          <Card className="bg-white/[.055] border-white/10">
            <CardContent className="p-6 space-y-6">
              <FormSection icon={PartyPopper} title="The event">
                <Field id="crew-title" label="Project / event name" required>
                  <Input
                    placeholder="e.g. Annual sales conference gala"
                    required
                    maxLength={160}
                    value={f.title}
                    onChange={(e) => setF({ ...f, title: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="crew-event-type" label="Event type">
                    <AppSelect
                      className="min-w-0"
                      value={f.eventType}
                      onValueChange={(v) => setF({ ...f, eventType: v })}
                      options={[
                        'Corporate event',
                        'Wedding',
                        'Concert',
                        'Festival',
                        'Conference',
                        'Awards show',
                        'Tour',
                        'Private event',
                      ]}
                    />
                  </Field>
                  <Field id="crew-city" label="City" required>
                    <Input
                      placeholder="e.g. Goa"
                      required
                      value={f.city}
                      onChange={(e) => setF({ ...f, city: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="crew-date" label="Event date" hint={formatInputEcho(f.eventDate)}>
                    <Input
                      type="date"
                      value={f.eventDate}
                      onChange={(e) => setF({ ...f, eventDate: e.target.value })}
                    />
                  </Field>
                  <Field
                    id="crew-audience"
                    label="Audience size"
                    help="Roughly how many guests. It decides how big the sound and stage crew needs to be."
                  >
                    <Input
                      placeholder="e.g. 300"
                      type="number"
                      min="0"
                      value={f.audienceSize}
                      onChange={(e) => setF({ ...f, audienceSize: e.target.value })}
                    />
                  </Field>
                </div>
              </FormSection>
              <FormSection
                icon={ListChecks}
                title="What you need"
                description="Tick everything you want covered. Not sure? Leave it and we suggest a starting crew."
              >
                <div className="grid grid-cols-2 gap-2">
                  {needOptions.map((x) => (
                    <label key={x} className="flex min-h-9 gap-2 items-center text-sm capitalize">
                      <Checkbox checked={f.needs.includes(x)} onCheckedChange={() => toggle(x)} />
                      {x}
                    </label>
                  ))}
                </div>
              </FormSection>
              <MoreDetails defaultOpen={!!(f.genres || f.budget || f.notes)}>
                <Field id="crew-genres" label="Genres" hint="Separate with commas.">
                  <Input
                    placeholder="e.g. Bollywood, jazz, EDM"
                    value={f.genres}
                    onChange={(e) => setF({ ...f, genres: e.target.value })}
                  />
                </Field>
                <Field
                  id="crew-budget"
                  label="Overall budget"
                  help="Your total for all music and crew, in rupees. It helps us suggest a realistic lineup; nobody else sees it."
                >
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g. 250000"
                    value={f.budget}
                    onChange={(e) => setF({ ...f, budget: e.target.value })}
                  />
                </Field>
                <Field id="crew-notes" label="Notes">
                  <textarea
                    className="w-full min-h-24 rounded-md bg-slate-900 border border-white/10 p-3"
                    placeholder="Anything unusual about the show?"
                    value={f.notes}
                    onChange={(e) => setF({ ...f, notes: e.target.value })}
                  />
                </Field>
              </MoreDetails>
              <Button
                className="w-full"
                onClick={create}
                disabled={!f.title.trim() || !f.city.trim() || busy === 'create'}
                aria-busy={busy === 'create'}
              >
                <WandSparkles size={16} className="mr-2" />
                {busy === 'create' ? 'Building…' : 'Build my crew'}
              </Button>
              {createError && (
                <p role="alert" className="text-sm text-rose-300">
                  {createError}
                </p>
              )}
              {(!f.title.trim() || !f.city.trim()) && (
                <p className="text-xs text-slate-500 text-center">Add an event name and city to build a crew.</p>
              )}
            </CardContent>
          </Card>
          <div className="space-y-4">
            {loadError && (
              <Card className="bg-white/[.035] border-white/10">
                <CardContent className="p-6 text-center" role="alert">
                  <p className="text-rose-300">{loadError}</p>
                  <Button
                    className="mt-3"
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
            )}
            {plans.map((p) => (
              <Card key={p.id} className="bg-white/[.055] border-white/10">
                <CardContent className="p-5">
                  <div className="flex flex-col md:flex-row justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{p.title}</h2>
                      <div className="text-sm text-slate-400 mt-1">
                        {optionLabel(p.event_type)} · {p.city}
                        {p.audience_size ? ` · ${p.audience_size} people` : ''}
                      </div>
                    </div>
                    {converted[p.id] ? (
                      <Button size="sm" variant="secondary" onClick={() => nav(bandBuilder)}>
                        Open Band Builder <ArrowRight size={15} className="ml-2" />
                      </Button>
                    ) : (
                      <Button size="sm" disabled={!!busy} aria-busy={busy === p.id} onClick={() => convert(p.id)}>
                        Move to Band Builder <ArrowRight size={15} className="ml-2" />
                      </Button>
                    )}
                  </div>
                  <div className="grid md:grid-cols-2 gap-2 mt-4">
                    {p.roles?.map((r) => (
                      <div key={r.id} className="rounded-lg bg-black/20 border border-white/10 p-3">
                        <div className="flex justify-between gap-2">
                          <b className="text-sm">
                            {r.roleName}
                            {r.instrument ? ` · ${r.instrument}` : ''}
                          </b>
                          <Badge variant={r.priority === 'required' ? 'default' : 'secondary'}>{r.priority}</Badge>
                        </div>
                        <div className="text-xs text-slate-500 mt-2">
                          {r.category} · ×{r.countNeeded}
                        </div>
                        <p className="text-xs text-slate-400 mt-2">{r.rationale}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {loading && !plans.length && (
              <p className="text-slate-400 text-center p-6" role="status">
                Loading crew plans…
              </p>
            )}
            {!loading && !loadError && !plans.length && (
              <Card className="bg-white/[.035] border-white/10">
                <CardContent className="p-10 text-center text-slate-500">
                  <Users className="mx-auto mb-3" />
                  Your recommended crew plans will appear here.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
