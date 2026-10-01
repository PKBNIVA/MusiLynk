// Shared display formatting for dates and money. Every page shows dates the same way
// ("11 Nov 2026", "11 Nov 2026, 4:18 pm") and amounts with Indian digit grouping
// ("₹15,000–35,000"), instead of raw ISO strings or ungrouped numbers.

const LOCALE = 'en-IN';
const DAY_MS = 86_400_000;

export type DateInput = string | number | Date | null | undefined;

export interface FormatOptions {
  /** IANA time zone; defaults to the viewer's own. */
  timeZone?: string;
  /** Returned when the value is empty or not a date. */
  fallback?: string;
}

/** en-IN spells September "Sept"; every other month is three letters, so keep them all alike. */
const shortMonth = (text: string) => text.replace(/\bSept\b/, 'Sep');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses an API value into a Date. A bare `YYYY-MM-DD` (a date column) is a calendar day, so it
 * is read as local midnight rather than UTC midnight, which would show the previous day west of UTC.
 */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "11 Nov 2026" */
export function formatDate(value: DateInput, options: FormatOptions = {}): string {
  const d = toDate(value);
  if (!d) return options.fallback ?? '';
  return shortMonth(
    new Intl.DateTimeFormat(LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: options.timeZone,
    }).format(d),
  );
}

/** "11 Nov 2026, 4:18 pm" */
export function formatDateTime(value: DateInput, options: FormatOptions = {}): string {
  const d = toDate(value);
  if (!d) return options.fallback ?? '';
  return shortMonth(
    new Intl.DateTimeFormat(LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: options.timeZone,
    }).format(d),
  );
}

/** The calendar day of `d` in `timeZone`, as a UTC timestamp at midnight, for day arithmetic. */
function dayNumber(d: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
    .formatToParts(d)
    .reduce<Record<string, number>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = Number(p.value);
      return acc;
    }, {});
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
}

export interface DeadlineOptions extends FormatOptions {
  /** Reference "now"; tests pass a fixed value. */
  now?: Date;
  /** Word before the date while open: "Closes" (cards) or "Apply by" (detail pages). */
  verb?: string;
}

/**
 * An application deadline with how far away it is:
 * "Closes 15 Dec 2026 · in 78 days", "Closes today", "Closes tomorrow", "Closed 3 Oct 2026".
 * Empty → "Open until filled" (or `fallback`).
 */
export function formatDeadline(value: DateInput, options: DeadlineOptions = {}): string {
  const d = toDate(value);
  if (!d) return options.fallback ?? 'Open until filled';
  const verb = options.verb ?? 'Closes';
  const date = formatDate(d, options);
  const days = dayNumber(d, options.timeZone) - dayNumber(options.now ?? new Date(), options.timeZone);
  if (days < 0) return `Closed ${date}`;
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow`;
  return `${verb} ${date} · in ${days} days`;
}

type Amount = number | string | null | undefined;

/** "1,25,000": a count with Indian digit grouping (never the viewer's browser locale). */
export function formatNumber(value: Amount): string {
  const n = toAmount(value);
  return n === null ? '' : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(n);
}

/**
 * The text with its indefinite article: "a drummer", "an instrument", "an FOH engineer", "a DJ",
 * "a ukulele player". For sentences built from role or instrument names.
 */
export function withArticle(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const word = t.split(/\s+/)[0];
  const spelled = /^[A-Z]{2,}$/.test(word)
    ? /^[AEFHILMNORSX]/.test(word)
    : /^[aeiou]/i.test(word) && !/^(uni|use|usu|uk|eu|one)/i.test(word);
  return `${spelled ? 'an' : 'a'} ${t}`;
}

/**
 * The visible echo of a native date input's value, in Indian order: "14 Nov 2026" for a date
 * input, "14 Nov 2026, 6 pm" for a datetime-local one. Native inputs show the browser's own order
 * (often month first), so the field carries this line next to it. Empty → ''.
 */
export function formatInputEcho(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  const text = withTime ? formatDateTime(value) : formatDate(value);
  return text.replace(':00 ', ' ');
}

/**
 * A billing period or fee basis as people say it: "per_event" → "event", "per hour" → "hour",
 * "month" → "month". Unknown values are spaced out, never printed raw.
 */
export function periodLabel(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^per[\s_-]+/, '')
    .replace(/[_-]+/g, ' ');
}

const toAmount = (value: Amount): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** "₹15,000" (never "INR 15,000") or "$1,500"; an unknown currency code falls back to "XYZ 1,500". */
export function formatMoney(value: Amount, currency = 'INR'): string {
  const n = toAmount(value);
  if (n === null) return '';
  const code = (currency || 'INR').toUpperCase();
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${code} ${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(n)}`;
  }
}

/** "₹" for INR, "$" for USD, the code itself when the currency has no symbol: for field labels. */
export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency || 'INR').toUpperCase();
  try {
    const part = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code }).formatToParts(0);
    return part.find((x) => x.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

export interface PayFields {
  salary?: string | null;
  currency?: string | null;
  compensation_min?: Amount;
  compensation_max?: Amount;
  compensation_period?: string | null;
}

/**
 * The pay line for a job: its free-text salary if set, else "₹15,000–35,000 / month",
 * "From ₹15,000", "Up to ₹35,000", or `fallback` when nothing is disclosed.
 */
export function formatPay(job: PayFields, fallback = 'Not disclosed'): string {
  if (job.salary) return job.salary;
  const min = toAmount(job.compensation_min);
  const max = toAmount(job.compensation_max);
  const currency = job.currency || 'INR';
  let range: string;
  if (min !== null && max !== null && max !== min) {
    const high = formatMoney(max, currency).replace(/^[^\d]+/, '');
    range = `${formatMoney(min, currency)}–${high}`;
  } else if (min !== null) {
    range = max === null ? `From ${formatMoney(min, currency)}` : formatMoney(min, currency);
  } else if (max !== null) {
    range = `Up to ${formatMoney(max, currency)}`;
  } else {
    return fallback;
  }
  const period = periodLabel(job.compensation_period);
  return period ? `${range} / ${period}` : range;
}

/** "Today 6 pm", "Tomorrow 6:30 pm", otherwise "Sat 14 Nov 6 pm". Empty → `fallback`. */
export function formatWhen(value: DateInput, options: FormatOptions & { now?: Date } = {}): string {
  const d = toDate(value);
  if (!d) return options.fallback ?? '';
  const tz = options.timeZone;
  const days = dayNumber(d, tz) - dayNumber(options.now ?? new Date(), tz);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
    .format(d)
    .replace(':00', '')
    .replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  const day = shortMonth(
    new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
      .format(d)
      .replace(',', ''),
  );
  return `${day} ${time}`;
}

// ---------------------------------------------------------------------------------------------
// Musician rates and response time, for cards and profiles.

export interface RateFields {
  sessionRate?: Amount;
  showRate?: Amount;
  dayRate?: Amount;
  tourDayRate?: Amount;
  hourlyRate?: Amount;
  currency?: string | null;
}

/** Lowest of the session, show, day and hourly rates that are filled in (tour-day pay is a different engagement); null when none. */
export function fromRate(p: RateFields): number | null {
  const rates = [p.sessionRate, p.showRate, p.dayRate, p.hourlyRate]
    .map(toAmount)
    .filter((n): n is number => n !== null && n > 0);
  return rates.length ? Math.min(...rates) : null;
}

/** "from ₹5,000", or '' when no rate is published. */
export function formatFromRate(p: RateFields): string {
  const rate = fromRate(p);
  return rate === null ? '' : `from ${formatMoney(rate, p.currency || 'INR')}`;
}

/** The filled rows of the rates table, in a fixed order: Session, Show, Day, Tour day, Hourly. */
export function rateRows(p: RateFields): { label: string; amount: string }[] {
  const rows: [string, Amount][] = [
    ['Session', p.sessionRate],
    ['Show', p.showRate],
    ['Day', p.dayRate],
    ['Tour day', p.tourDayRate],
    ['Hourly', p.hourlyRate],
  ];
  return rows.flatMap(([label, value]) => {
    const n = toAmount(value);
    return n !== null && n > 0 ? [{ label, amount: formatMoney(n, p.currency || 'INR') }] : [];
  });
}

/** "Replies in ~12 min", "Replies in ~2 h"; '' when the response time is not known. */
export function formatReplyTime(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 90) return `Replies in ~${Math.max(1, Math.round(minutes))} min`;
  return `Replies in ~${Math.round(minutes / 60)} h`;
}
