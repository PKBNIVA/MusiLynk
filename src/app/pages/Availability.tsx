import { useEffect, useState } from 'react';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { AvailabilityWindow } from '../lib/apiTypes';
import { Field, FormError } from '../components/form/Field';
import { useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { AppSelect } from '../components/ui/app-select';
import { formatDateTime, formatInputEcho } from '../lib/format';
import { useConfirm } from '../components/booking/BookingDialogs';
import { optionLabel } from '../components/ui/option-labels';

type SlotField = 'startAt' | 'endAt' | 'city' | 'status';
const SLOT_IDS: Record<SlotField, string> = {
  startAt: 'availability-start',
  endAt: 'availability-end',
  city: 'availability-city',
  status: 'availability-status',
};
// datetime-local value for "now" in the browser's zone, used as the earliest selectable start.
const localNow = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Mirrors AvailabilityWindow validations: both times, end after start, start not in the past. */
function validateSlot(form: AvailabilityForm) {
  const errors: Partial<Record<SlotField, string>> = {};
  const start = form.startAt ? new Date(form.startAt).getTime() : NaN;
  const end = form.endAt ? new Date(form.endAt).getTime() : NaN;
  if (!form.startAt) errors.startAt = 'Choose a start time.';
  else if (start < Date.now() - 5 * 60_000) errors.startAt = 'Choose a start time in the future.';
  if (!form.endAt) errors.endAt = 'Choose an end time.';
  else if (!Number.isNaN(start) && end <= start) errors.endAt = 'End must be after the start.';
  if ((form.city || '').trim().length > 120) errors.city = 'Keep the city under 120 characters.';
  return errors;
}

type AvailabilityForm = { startAt?: string; endAt?: string; city?: string; status: string };

export default function Availability() {
  const [items, setItems] = useState<AvailabilityWindow[]>([]);
  const [form, setForm] = useState<AvailabilityForm>({ status: 'available' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removeError, setRemoveError] = useState('');
  const { ask, element: confirmDialog } = useConfirm();
  const errors = useFormErrors<SlotField>({ ids: SLOT_IDS });
  const submit = useSubmitOnce();
  const saving = submit.busy;
  const set = (key: SlotField, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    errors.clear(key);
  };

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet<{ windows?: AvailabilityWindow[] }>('/availability');
      setItems(data.windows || []);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Unable to load availability.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function add(e?: React.FormEvent) {
    e?.preventDefault();
    void submit.run(async () => {
      errors.setFormError('');
      if (errors.setErrors(validateSlot(form))) {
        errors.focusFirst();
        return;
      }
      try {
        // datetime-local has no zone; send an absolute instant so the server does not read it as UTC.
        await apiPost('/availability', {
          ...form,
          startAt: new Date(form.startAt!).toISOString(),
          endAt: new Date(form.endAt!).toISOString(),
          city: form.city?.trim() || null,
        });
        setForm({ status: 'available' });
        await load();
        toast.success('Availability added.');
      } catch (e: unknown) {
        if (errors.setFromApi(e, 'Unable to add availability. Try again.')) errors.focusFirst();
      }
    });
  }
  const remove = (item: AvailabilityWindow) => {
    setRemoveError('');
    ask({
      title: 'Remove this availability?',
      description: `${optionLabel(item.status)}, ${formatDateTime(item.startAt)} to ${formatDateTime(item.endAt)}${item.city ? ` in ${item.city}` : ''}. Hirers will no longer see this window. You can add it again later.`,
      confirmLabel: 'Remove availability',
      destructive: true,
      action: async () => {
        await apiDelete(`/availability/${item.id}`);
        setItems((current) => current.filter((i) => i.id !== item.id));
        toast.success('Availability removed.');
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader title="Availability" help={<HelpCallout {...HELP.availability} />} />
        <Card className="bg-white/[.055] border-white/10 mt-7">
          <CardContent className="p-5">
            <form onSubmit={add} noValidate className="grid md:grid-cols-5 gap-3 items-start">
              <Field
                id={SLOT_IDS.startAt}
                label="Start"
                required
                error={errors.errors.startAt}
                hint={formatInputEcho(form.startAt, true)}
              >
                <Input
                  type="datetime-local"
                  min={localNow()}
                  value={form.startAt || ''}
                  onChange={(e) => set('startAt', e.target.value)}
                  className="bg-white/5 border-white/15"
                />
              </Field>
              <Field
                id={SLOT_IDS.endAt}
                label="End"
                required
                error={errors.errors.endAt}
                hint={formatInputEcho(form.endAt, true)}
              >
                <Input
                  type="datetime-local"
                  min={form.startAt || localNow()}
                  value={form.endAt || ''}
                  onChange={(e) => set('endAt', e.target.value)}
                  className="bg-white/5 border-white/15"
                />
              </Field>
              <Field id={SLOT_IDS.city} label="City" optional error={errors.errors.city}>
                <Input
                  value={form.city || ''}
                  maxLength={120}
                  autoComplete="address-level2"
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="Mumbai"
                  className="bg-white/5 border-white/15"
                />
              </Field>
              <Field
                id={SLOT_IDS.status}
                label="Status"
                error={errors.errors.status}
                help="Available: open to offers. On hold: pencilled in. Tentative: ask first. Booked or unavailable: not free."
              >
                <AppSelect
                  value={form.status}
                  onValueChange={(v) => set('status', v)}
                  className="h-11 rounded-xl"
                  options={['available', 'hold', 'tentative', 'booked', 'unavailable']}
                />
              </Field>
              <Button type="submit" disabled={saving} aria-busy={saving} className="md:mt-6">
                <CalendarPlus size={16} className="mr-2" />
                {saving ? 'Adding…' : 'Add'}
              </Button>
              <FormError message={errors.formError} className="md:col-span-5" />
            </form>
          </CardContent>
        </Card>
        <FormError message={removeError} className="mt-4" />
        {loading ? (
          <p className="text-slate-400 text-center py-14" role="status">
            Loading availability…
          </p>
        ) : error ? (
          <div className="text-center py-14" role="alert">
            <p className="text-rose-300">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : items.length ? (
          <div className="grid gap-3 mt-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
              >
                <div>
                  <b>{optionLabel(item.status)}</b>
                  <div className="text-sm text-slate-400">
                    {formatDateTime(item.startAt)} → {formatDateTime(item.endAt)} {item.city ? `· ${item.city}` : ''}
                  </div>
                </div>
                <Button aria-label="Remove availability" size="icon" variant="ghost" onClick={() => remove(item)}>
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-center py-14">
            No availability published yet. Choose a start and end time above to add your first window.
          </p>
        )}
      </main>
      {confirmDialog}
    </div>
  );
}
