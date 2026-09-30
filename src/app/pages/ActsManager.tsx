import { EmptyState } from '../components/kit/EmptyState';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { FormDialog, useConfirm } from '../components/booking/BookingDialogs';
import { Music, Plus, Users, Mic2 } from 'lucide-react';
import { toast } from 'sonner';
import { Field, FormError, RequiredNote } from '../components/form/Field';
import { MoreDetails } from '../components/help/MoreDetails';
import { useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { errorMessage } from '../lib/errors';
import type { Act, ActMember, Taxonomy } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';

const FALLBACK_ACT_TYPES = ['solo', 'duo', 'trio', 'band', 'ensemble', 'dj'];
// Inputs hand back strings, so the lineup size holds whatever was typed until it is submitted.
type ActForm = {
  name: string;
  actType: string;
  city: string;
  genres: string;
  minFee: string;
  maxFee: string;
  lineupSize: number | string;
  ownerRole: string;
};
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export default function ActsManager() {
  const base = `/${useLocation().pathname.split('/')[1] || 'jobseeker'}`;
  const [acts, setActs] = useState<Act[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [actTypes, setActTypes] = useState<string[]>(FALLBACK_ACT_TYPES),
    [f, setF] = useState<ActForm>({
      name: '',
      actType: 'band',
      city: '',
      genres: '',
      minFee: '',
      maxFee: '',
      lineupSize: 1,
      ownerRole: 'Band Leader',
    }),
    [member, setMember] = useState<{
      actId: string;
      actName: string;
      displayName: string;
      roleName: string;
      instrument: string;
    } | null>(null),
    [memberError, setMemberError] = useState(''),
    [savingMember, setSavingMember] = useState(false),
    [togglingId, setTogglingId] = useState<string | null>(null),
    [statusError, setStatusError] = useState('');
  const { ask, element: confirmDialog } = useConfirm();
  type ActField = 'name' | 'city' | 'genres' | 'minFee' | 'maxFee' | 'lineupSize' | 'ownerRole';
  const actErrors = useFormErrors<ActField>({ idFor: (k) => `act-${k}` });
  const createOnce = useSubmitOnce();
  const creating = createOnce.busy;
  const setAct = (k: keyof ActForm, v: string) => {
    setF((current) => ({ ...current, [k]: v }));
    actErrors.clear(k as ActField);
  };
  async function load() {
    try {
      const d = await apiGet<{ acts?: Act[] }>('/acts/me');
      setActs(d.acts || []);
      setLoadError('');
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Unable to load your acts.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    apiGet<Partial<Taxonomy>>('/taxonomy')
      .then((t) => {
        const types = list(t?.actTypes);
        if (types.length) setActTypes(types);
      })
      .catch(() => {});
  }, []);
  function create() {
    return createOnce.run(async () => {
      const minFee = f.minFee === '' ? null : Number(f.minFee);
      const maxFee = f.maxFee === '' ? null : Number(f.maxFee);
      const errors: Partial<Record<ActField, string>> = {};
      if (!f.name.trim()) errors.name = 'Enter the act or stage name.';
      else if (f.name.trim().length > 120) errors.name = 'Keep the name under 120 characters.';
      if (minFee !== null && (!Number.isInteger(minFee) || minFee < 0))
        errors.minFee = 'Enter a whole number of 0 or more.';
      if (maxFee !== null && (!Number.isInteger(maxFee) || maxFee < 0))
        errors.maxFee = 'Enter a whole number of 0 or more.';
      else if (minFee !== null && maxFee !== null && maxFee < minFee)
        errors.maxFee = 'Max fee must be at least the min fee.';
      if (!(Number(f.lineupSize) >= 1)) errors.lineupSize = 'Lineup size must be at least 1.';
      actErrors.setFormError('');
      if (actErrors.setErrors(errors)) {
        actErrors.focusFirst();
        return;
      }
      try {
        await apiPost('/acts', {
          ...f,
          name: f.name.trim(),
          genres: f.genres
            .split(',')
            .map((x: string) => x.trim())
            .filter(Boolean),
          minFee,
          maxFee,
          lineupSize: Math.max(1, Math.floor(Number(f.lineupSize)) || 1),
        });
        toast.success('Bookable act created');
        setF((current) => ({ ...current, name: '', city: '', genres: '', minFee: '', maxFee: '' }));
        await load();
      } catch (e: unknown) {
        if (actErrors.setFromApi(e, 'The act could not be created. Try again.')) actErrors.focusFirst();
      }
    });
  }
  async function saveMember() {
    if (!member || savingMember) return;
    if (!member.displayName.trim() || !member.roleName.trim()) return setMemberError("Add the member's name and role.");
    setSavingMember(true);
    setMemberError('');
    try {
      await apiPost(`/acts/${member.actId}/members`, {
        displayName: member.displayName.trim(),
        roleName: member.roleName.trim(),
        instrument: member.instrument.trim() || null,
      });
      toast.success('Lineup member added');
      setMember(null);
      await load();
    } catch (e: unknown) {
      setMemberError(errorMessage(e, 'Unable to add this member.'));
    } finally {
      setSavingMember(false);
    }
  }
  const removeMember = (actId: string, m: ActMember) =>
    ask({
      title: `Remove ${m.displayName}?`,
      description: "They will no longer appear in this act's public lineup.",
      confirmLabel: 'Remove member',
      destructive: true,
      action: async () => {
        await apiDelete(`/acts/${actId}/members/${m.id}`);
        toast.success('Lineup member removed');
        await load();
      },
    });
  async function changeStatus(act: Act) {
    if (togglingId) return;
    setStatusError('');
    setTogglingId(act.id);
    try {
      if (act.status === 'active') await apiDelete(`/acts/${act.id}`);
      else await apiPatch(`/acts/${act.id}`, { status: 'active' });
      toast.success(act.status === 'active' ? 'Act hidden from booking' : 'Act published for booking');
      await load();
    } catch (e: unknown) {
      setStatusError(errorMessage(e, 'The act could not be updated. Try again.'));
    } finally {
      setTogglingId(null);
    }
  }
  const setM = (key: 'displayName' | 'roleName' | 'instrument', value: string) =>
    setMember((current) => (current ? { ...current, [key]: value } : current));
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader title="My acts" help={<HelpCallout {...HELP.acts} />} />
        <div className="grid lg:grid-cols-[.9fr_1.1fr] gap-6">
          <Card className="bg-white/[.055] border-white/10">
            <CardContent className="p-6">
              <form
                className="space-y-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Plus size={18} />
                  Create act
                </h2>
                <RequiredNote />
                <Field id="act-name" label="Act / stage name" required error={actErrors.errors.name}>
                  <Input
                    placeholder="e.g. The Monsoon Collective"
                    maxLength={120}
                    value={f.name}
                    onChange={(e) => setAct('name', e.target.value)}
                  />
                </Field>
                <Field id="act-type" label="Act type">
                  <AppSelect
                    className="h-11 rounded-xl"
                    value={f.actType}
                    onValueChange={(v) => setF({ ...f, actType: v })}
                    options={actTypes.includes(f.actType) ? actTypes : [f.actType, ...actTypes]}
                  />
                </Field>
                <Field id="act-city" label="City / base" error={actErrors.errors.city}>
                  <Input
                    placeholder="e.g. Mumbai"
                    autoComplete="address-level2"
                    value={f.city}
                    onChange={(e) => setAct('city', e.target.value)}
                  />
                </Field>
                <Field id="act-genres" label="Genres" hint="Separate with commas." error={actErrors.errors.genres}>
                  <Input
                    placeholder="e.g. Sufi, Bollywood"
                    value={f.genres}
                    onChange={(e) => setAct('genres', e.target.value)}
                  />
                </Field>
                <MoreDetails
                  label="Fees & lineup (optional)"
                  forceOpen={
                    !!(
                      actErrors.errors.minFee ||
                      actErrors.errors.maxFee ||
                      actErrors.errors.lineupSize ||
                      actErrors.errors.ownerRole
                    )
                  }
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      id="act-minFee"
                      label="Min fee (₹)"
                      error={actErrors.errors.minFee}
                      help="Your usual starting fee for one performance. Bookers see it as an indicative range, not a fixed quote."
                    >
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={f.minFee}
                        onChange={(e) => setAct('minFee', e.target.value)}
                      />
                    </Field>
                    <Field id="act-maxFee" label="Max fee (₹)" error={actErrors.errors.maxFee}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={f.maxFee}
                        onChange={(e) => setAct('maxFee', e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      id="act-lineupSize"
                      label="Lineup size"
                      error={actErrors.errors.lineupSize}
                      help="How many people perform, including you. You can name each member after creating the act."
                    >
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={f.lineupSize}
                        onChange={(e) => setAct('lineupSize', e.target.value)}
                      />
                    </Field>
                    <Field id="act-ownerRole" label="Your role" error={actErrors.errors.ownerRole}>
                      <Input value={f.ownerRole} onChange={(e) => setAct('ownerRole', e.target.value)} />
                    </Field>
                  </div>
                </MoreDetails>
                <FormError message={actErrors.formError} />
                <Button type="submit" className="w-full" disabled={creating} aria-busy={creating}>
                  <Music size={16} className="mr-2" />
                  {creating ? 'Creating…' : 'Create bookable act'}
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <FormError message={statusError} />
            {loading ? (
              <p className="text-slate-400 text-center py-16" role="status">
                Loading your acts…
              </p>
            ) : loadError ? (
              <div className="text-center py-16" role="alert">
                <p className="text-rose-300">{loadError}</p>
                <Button variant="outline" className="mt-4" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : acts.length === 0 ? (
              <EmptyState icon={Mic2} title="No act created yet.">
                Use the form to create your first bookable act. It takes about a minute.
              </EmptyState>
            ) : (
              acts.map((a) => (
                <Card key={a.id} className="bg-white/[.055] border-white/10">
                  <CardContent className="p-5">
                    <div className="flex justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold break-words">{a.name}</h3>
                          <Badge variant="secondary">{a.act_type}</Badge>
                          <Badge className="capitalize">{a.status}</Badge>
                        </div>
                        <p className="text-slate-400 text-sm mt-2">
                          {a.city || 'Location not set'} · lineup {a.lineup_size}
                        </p>
                        <p className="text-sm mt-3">
                          {list(a.genres).join(' · ') || 'Add genres to improve discovery'}
                        </p>
                      </div>
                      <Users className="text-violet-300 shrink-0" />
                    </div>
                    {Boolean(a.min_fee || a.max_fee) && (
                      <div className="mt-4 text-sm text-emerald-300">
                        Indicative ₹{Number(a.min_fee || 0).toLocaleString('en-IN')} – ₹
                        {Number(a.max_fee || a.min_fee || 0).toLocaleString('en-IN')} / {a.fee_basis}
                      </div>
                    )}
                    <div className="mt-5 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Lineup</h4>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setMemberError('');
                            setMember({ actId: a.id, actName: a.name, displayName: '', roleName: '', instrument: '' });
                          }}
                        >
                          <Plus size={14} />
                          Add member
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(a.members || []).map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-2 rounded-lg bg-black/15 p-3"
                          >
                            <div className="min-w-0">
                              <div className="font-medium break-words">{m.displayName}</div>
                              <div className="text-xs text-slate-400">
                                {m.roleName}
                                {m.instrument ? ` · ${m.instrument}` : ''}
                              </div>
                            </div>
                            {m.isLeader ? (
                              <Badge variant="secondary">Leader</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Remove ${m.displayName}`}
                                onClick={() => removeMember(a.id, m)}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={togglingId === a.id}
                          aria-busy={togglingId === a.id}
                          onClick={() => void changeStatus(a)}
                        >
                          {togglingId === a.id
                            ? 'Saving…'
                            : a.status === 'active'
                              ? 'Hide from booking'
                              : 'Publish for booking'}
                        </Button>
                        {a.status === 'active' && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to={`/acts/${a.id}`}>View public page</Link>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`${base}/bookings`}>Bookings</Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
        <FormDialog
          open={Boolean(member)}
          onOpenChange={(open) => !open && setMember(null)}
          title="Add a lineup member"
          description={member ? `Shown on ${member.actName}'s lineup.` : undefined}
          submitLabel="Add member"
          busyLabel="Adding…"
          busy={savingMember}
          canSubmit={Boolean(member?.displayName.trim() && member?.roleName.trim())}
          error={memberError}
          onSubmit={saveMember}
        >
          {member && (
            <>
              <Field id="member-name" label="Member name" required>
                <Input value={member.displayName} onChange={(e) => setM('displayName', e.target.value)} />
              </Field>
              <Field id="member-role" label="Role in the act" required hint="For example Vocalist or Drummer">
                <Input value={member.roleName} onChange={(e) => setM('roleName', e.target.value)} />
              </Field>
              <Field id="member-instrument" label="Instrument or voice" optional>
                <Input value={member.instrument} onChange={(e) => setM('instrument', e.target.value)} />
              </Field>
            </>
          )}
        </FormDialog>
        {confirmDialog}
      </main>
    </div>
  );
}
