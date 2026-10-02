import type { Job } from '../../lib/apiTypes';

const EMPLOYMENT_TYPES: Record<string, string> = {
  'full-time': 'FULL_TIME',
  'full time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  'part time': 'PART_TIME',
  contract: 'CONTRACTOR',
  contractor: 'CONTRACTOR',
  freelance: 'CONTRACTOR',
  'project-based': 'CONTRACTOR',
  temporary: 'TEMPORARY',
  temp: 'TEMPORARY',
  internship: 'INTERN',
  intern: 'INTERN',
};

/** The only pay periods Google's JobPosting accepts for baseSalary.unitText. */
const SALARY_UNITS: Record<string, string> = {
  hour: 'HOUR',
  hourly: 'HOUR',
  day: 'DAY',
  daily: 'DAY',
  week: 'WEEK',
  weekly: 'WEEK',
  month: 'MONTH',
  monthly: 'MONTH',
  year: 'YEAR',
  yearly: 'YEAR',
  annual: 'YEAR',
};

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Google reads the description as HTML; ours is plain text, so keep its line breaks. */
function descriptionHtml(job: Job) {
  const parts = [job.description, job.requirements ? `Requirements: ${job.requirements}` : ''].filter(
    Boolean,
  ) as string[];
  return parts.map((part) => `<p>${escapeHtml(part.trim()).replace(/\r?\n/g, '<br>')}</p>`).join('');
}

function isoDate(value?: string | null) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * JobPosting structured data for a public opportunity, or undefined when the listing cannot be
 * described to Google's JobPosting rules without guessing. Google requires title, description,
 * datePosted, hiringOrganization and a location (or a remote flag with where applicants may live);
 * anything we cannot fill honestly is left out, and an expired or closed listing emits nothing.
 * `now` is injectable for tests.
 */
export function jobPostingJsonLd(job: Job, now: Date = new Date()): Record<string, unknown> | undefined {
  const datePosted = isoDate(job.published_at || job.created_at);
  const description = descriptionHtml(job);
  const company = (job.company || '').trim();
  if (!job.title || !description || !datePosted || !company) return undefined;
  if (job.status && job.status !== 'open' && job.status !== 'active' && job.status !== 'published') return undefined;
  const validThrough = isoDate(job.application_deadline);
  if (validThrough && Date.parse(validThrough) < now.getTime()) return undefined;

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
    datePosted,
    hiringOrganization: { '@type': 'Organization', name: company },
    identifier: { '@type': 'PropertyValue', name: 'MusiLynk', value: String(job.id) },
  };
  const employmentType = EMPLOYMENT_TYPES[(job.type || '').trim().toLowerCase()];
  if (employmentType) ld.employmentType = employmentType;
  if (validThrough) ld.validThrough = validThrough;

  if (job.workplace === 'remote') {
    // Google needs to know who may apply from where; MusiLynk is an India-only marketplace.
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'IN' };
  } else if (job.location?.trim()) {
    ld.jobLocation = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: job.location.trim(), addressCountry: 'IN' },
    };
  } else {
    return undefined;
  }

  const unitText = SALARY_UNITS[(job.compensation_period || '').trim().toLowerCase()];
  const min = job.compensation_min ?? undefined;
  const max = job.compensation_max ?? undefined;
  if (job.paid !== false && unitText && ((min ?? 0) > 0 || (max ?? 0) > 0)) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.currency || 'INR',
      value: {
        '@type': 'QuantitativeValue',
        ...(min != null && min > 0 ? { minValue: min } : {}),
        ...(max != null && max > 0 ? { maxValue: max } : {}),
        unitText,
      },
    };
  }
  return ld;
}
