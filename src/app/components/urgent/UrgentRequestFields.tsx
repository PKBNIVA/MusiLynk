import { AutocompleteInput } from '../ai/AutocompleteInput';
import { AppSelect } from '../ui/app-select';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Field } from '../form/Field';
import { MoreDetails } from '../help/MoreDetails';
import { BUDGET_BANDS, URGENT_IDS, type UrgentField, type UrgentFormValues } from '../../lib/urgentForm';

/**
 * The urgent request's fields: five required answers, then "More details". The public /urgent
 * page and the signed-in urgent page both render this, so the two can never drift apart again.
 */
export function UrgentRequestFields({
  values,
  errors,
  onChange,
}: {
  values: UrgentFormValues;
  errors: Partial<Record<UrgentField, string>>;
  onChange: <K extends keyof UrgentFormValues>(key: K, value: UrgentFormValues[K]) => void;
}) {
  const shown = (error?: string) =>
    error && (
      <p role="alert" className="mt-1.5 text-sm text-rose-300">
        {error}
      </p>
    );
  return (
    <div className="space-y-4">
      <div>
        <AutocompleteInput
          id={URGENT_IDS.role}
          field="roles"
          label="Role needed"
          multiple={false}
          values={values.role}
          onChange={(next) => onChange('role', next)}
          placeholder="Drummer, wedding singer, live sound engineer…"
        />
        {shown(errors.role)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={URGENT_IDS.startAt} label="Date & time" required error={errors.startAt}>
          <Input type="datetime-local" value={values.startAt} onChange={(e) => onChange('startAt', e.target.value)} />
        </Field>
        <div>
          <AutocompleteInput
            id={URGENT_IDS.city}
            field="cities"
            label="City"
            multiple={false}
            values={values.city}
            onChange={(next) => onChange('city', next)}
          />
          {shown(errors.city)}
        </div>
      </div>
      <Field id={URGENT_IDS.budget} label="Budget" required error={errors.budget}>
        {(control) => (
          <AppSelect
            {...control}
            aria-invalid={control['aria-invalid']}
            value={values.budget}
            onValueChange={(next) => onChange('budget', next)}
            placeholder="Choose a budget band"
            options={[
              { value: '', label: 'Choose a budget band', description: null },
              ...BUDGET_BANDS.map((band) => ({ value: band.value, label: band.label, description: null })),
            ]}
          />
        )}
      </Field>
      <Field
        id={URGENT_IDS.note}
        label="Short note"
        required
        error={errors.note}
        count={values.note.length}
        maxLength={1000}
      >
        <Textarea
          value={values.note}
          maxLength={1000}
          onChange={(e) => onChange('note', e.target.value)}
          placeholder="Anything they should know before saying yes: set list, dress code, load-in time."
          className="min-h-24 border-white/10 bg-slate-900"
        />
      </Field>
      <MoreDetails forceOpen={Boolean(errors.endAt)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="urgent-venue" label="Venue or studio" optional>
            <Input
              value={values.venue}
              onChange={(e) => onChange('venue', e.target.value)}
              placeholder="e.g. Blue Frog, Lower Parel"
            />
          </Field>
          <Field id={URGENT_IDS.endAt} label="Ends" optional error={errors.endAt}>
            <Input
              type="datetime-local"
              min={values.startAt}
              value={values.endAt}
              onChange={(e) => onChange('endAt', e.target.value)}
            />
          </Field>
          <Field id="urgent-instrument" label="Instrument" optional>
            <Input value={values.instrument} onChange={(e) => onChange('instrument', e.target.value)} />
          </Field>
          <AutocompleteInput
            id="urgent-genres"
            field="genres"
            label="Genres (optional)"
            values={values.genres}
            onChange={(next) => onChange('genres', next)}
          />
        </div>
        <Field id="urgent-requirements" label="Requirements" optional>
          <Textarea
            value={values.requirements}
            onChange={(e) => onChange('requirements', e.target.value)}
            placeholder="Gear they should bring, charts to read, anything else that matters."
            className="min-h-20 border-white/10 bg-slate-900"
          />
        </Field>
      </MoreDetails>
    </div>
  );
}
