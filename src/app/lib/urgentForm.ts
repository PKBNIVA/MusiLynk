import { useState } from 'react';
import { useFormErrors } from './formErrors';

// The one urgent-request form, used by the public /urgent page and by /employer/urgent (and
// /jobseeker/urgent): five required answers (role, when, city, budget band, note) and a few
// optional details. The API applies the same rules (UrgentRequestsController#create).

/** UrgentConfig.response_time_promise (backend/config/urgent.yml), shown under the button. */
export const URGENT_PROMISE = 'within 2 hours, 9am–11pm IST';

export interface BudgetBand {
  value: string;
  label: string;
  min: number;
  max: number | null;
}
export const BUDGET_BANDS: BudgetBand[] = [
  { value: 'under-5k', label: 'Under ₹5,000', min: 0, max: 5_000 },
  { value: '5k-10k', label: '₹5,000 – ₹10,000', min: 5_000, max: 10_000 },
  { value: '10k-25k', label: '₹10,000 – ₹25,000', min: 10_000, max: 25_000 },
  { value: '25k-50k', label: '₹25,000 – ₹50,000', min: 25_000, max: 50_000 },
  { value: '50k-plus', label: '₹50,000 or more', min: 50_000, max: null },
];

export interface UrgentFormValues {
  role: string[];
  city: string[];
  /** datetime-local value */
  startAt: string;
  /** BudgetBand.value, or '' */
  budget: string;
  note: string;
  venue: string;
  /** datetime-local value, or '' */
  endAt: string;
  instrument: string;
  requirements: string;
  genres: string[];
}

export type UrgentField = 'role' | 'startAt' | 'city' | 'budget' | 'note' | 'endAt';
export const URGENT_IDS: Record<UrgentField, string> = {
  role: 'urgent-role',
  startAt: 'urgent-start',
  city: 'urgent-city',
  budget: 'urgent-budget',
  note: 'urgent-note',
  endAt: 'urgent-end',
};
/** API field names (UrgentRequestsController#create errors) to this form's fields. */
const API_FIELDS: Record<string, UrgentField> = {
  title: 'role',
  roleName: 'role',
  startAt: 'startAt',
  endAt: 'endAt',
  city: 'city',
  budget: 'budget',
  budgetMin: 'budget',
  budgetMax: 'budget',
  note: 'note',
};

/** Tomorrow, 6pm local, as a datetime-local value: the default "when" for "need someone by tomorrow". */
export function defaultStartAt(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function emptyUrgentValues(initial: { role?: string; city?: string } = {}): UrgentFormValues {
  return {
    role: initial.role ? [initial.role] : [],
    city: [initial.city || 'Mumbai'],
    startAt: defaultStartAt(),
    budget: '',
    note: '',
    venue: '',
    endAt: '',
    instrument: '',
    requirements: '',
    genres: [],
  };
}

/** Every problem at once, per field. */
export function validateUrgent(values: UrgentFormValues, now = Date.now()): Partial<Record<UrgentField, string>> {
  const errors: Partial<Record<UrgentField, string>> = {};
  if (!values.role[0]?.trim()) errors.role = 'Say who you need, e.g. Drummer or Live sound engineer.';
  if (!values.startAt) errors.startAt = 'Choose the date and time you need them.';
  else if (Number.isNaN(new Date(values.startAt).getTime())) errors.startAt = 'Choose a valid date and time.';
  else if (new Date(values.startAt).getTime() < now - 60_000)
    errors.startAt = 'Choose a time that has not already passed.';
  if (!values.city[0]?.trim()) errors.city = 'Tell us the city.';
  if (!BUDGET_BANDS.some((band) => band.value === values.budget)) errors.budget = 'Choose a budget.';
  if (!values.note.trim()) errors.note = 'Add a short note, e.g. set length, dress code or load-in time.';
  if (values.endAt && values.startAt && new Date(values.endAt).getTime() <= new Date(values.startAt).getTime())
    errors.endAt = 'The end time must be after the start.';
  return errors;
}

/** The sentence a dialog shows above its buttons when fields are missing. */
export function urgentSummary(errors: Partial<Record<UrgentField, string>>) {
  const names: Record<UrgentField, string> = {
    role: 'role',
    startAt: 'time',
    city: 'city',
    budget: 'budget',
    note: 'a short note',
    endAt: 'end time',
  };
  const missing = (Object.keys(errors) as UrgentField[]).filter((key) => errors[key]).map((key) => names[key]);
  if (!missing.length) return '';
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
  return `Check the ${list} before posting.`;
}

/** The POST /urgent-requests body (also what a signed-out visitor's draft holds). */
export interface UrgentRequestBody {
  title: string;
  roleName: string;
  city: string;
  startAt: string;
  endAt?: string | null;
  instrument?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  note?: string | null;
  venue?: string | null;
  requirements?: string | null;
  genre?: string | null;
}

export function urgentBody(values: UrgentFormValues): UrgentRequestBody {
  const band = BUDGET_BANDS.find((candidate) => candidate.value === values.budget);
  const role = values.role[0].trim();
  const city = values.city[0].trim();
  return {
    title: `${role} needed in ${city}`,
    roleName: role,
    city,
    startAt: new Date(values.startAt).toISOString(),
    endAt: values.endAt ? new Date(values.endAt).toISOString() : null,
    instrument: values.instrument.trim() || null,
    budgetMin: band ? band.min : null,
    budgetMax: band ? band.max : null,
    note: values.note.trim() || null,
    venue: values.venue.trim() || null,
    requirements: values.requirements.trim() || null,
    genre: values.genres.join(', ') || null,
  };
}

/** Form state, per-field errors and the request body for the urgent form. */
export function useUrgentForm(initial: { role?: string; city?: string } = {}) {
  const [values, setValues] = useState<UrgentFormValues>(() => emptyUrgentValues(initial));
  const form = useFormErrors<UrgentField>({ ids: URGENT_IDS, apiFields: API_FIELDS });
  const set = <K extends keyof UrgentFormValues>(key: K, value: UrgentFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in URGENT_IDS) form.clear(key as UrgentField);
  };
  /** The request body when everything is filled in; otherwise shows the errors and returns null. */
  const validate = (): UrgentRequestBody | null => {
    const errors = validateUrgent(values);
    if (form.setErrors(errors)) {
      form.setFormError(urgentSummary(errors));
      form.focusFirst();
      return null;
    }
    form.setFormError('');
    return urgentBody(values);
  };
  return { values, set, form, validate, reset: () => setValues(emptyUrgentValues(initial)) };
}
