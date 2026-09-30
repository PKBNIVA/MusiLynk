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
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: options.timeZone,
  }).format(d);
}

/** "11 Nov 2026, 4:18 pm" */
export function formatDateTime(value: DateInput, options: FormatOptions = {}): string {
  const d = toDate(value);
  if (!d) return options.fallback ?? '';
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options.timeZone,
  }).format(d);
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

const toAmount = (value: Amount): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** "₹15,000" (INR) or "$1,500"; an unknown currency code falls back to "XYZ 1,500". */
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
  return job.compensation_period ? `${range} / ${job.compensation_period}` : range;
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
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
    .format(d)
    .replace(',', '');
  return `${day} ${time}`;
}
