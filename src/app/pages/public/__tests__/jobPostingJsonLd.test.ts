import { describe, expect, it } from 'vitest';
import type { Job } from '../../../lib/apiTypes';
import { jobPostingJsonLd } from '../jobPostingJsonLd';

const NOW = new Date('2026-10-01T00:00:00Z');
const job = (over: Partial<Job> = {}) =>
  ({
    id: 'j1',
    title: 'Tabla player for wedding season',
    company: 'Raga Events',
    description: 'Evening sets.\nTravel paid <b>',
    location: 'Mumbai',
    status: 'published',
    type: 'Contract',
    published_at: '2026-09-20T10:00:00Z',
    paid: true,
    skills: [],
    ...over,
  }) as Job;

describe('jobPostingJsonLd', () => {
  it('fills Google required fields and escapes the plain-text description', () => {
    const ld = jobPostingJsonLd(job(), NOW)!;
    expect(ld['@type']).toBe('JobPosting');
    expect(ld.datePosted).toBe('2026-09-20T10:00:00.000Z');
    expect(ld.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Raga Events' });
    expect(ld.description).toBe('<p>Evening sets.<br>Travel paid &lt;b&gt;</p>');
    expect(ld.employmentType).toBe('CONTRACTOR');
    expect(ld).not.toHaveProperty('directApply');
    expect((ld.jobLocation as { address: { addressLocality: string } }).address.addressLocality).toBe('Mumbai');
  });

  it('omits pay it cannot express and employment types it cannot map', () => {
    const ld = jobPostingJsonLd(job({ type: 'Gig', compensation_min: 5000, compensation_period: 'project' }), NOW)!;
    expect(ld).not.toHaveProperty('baseSalary');
    expect(ld).not.toHaveProperty('employmentType');
  });

  it('emits baseSalary only with a valid unit and no undefined bounds', () => {
    const ld = jobPostingJsonLd(
      job({ compensation_min: 20000, compensation_max: null, compensation_period: 'month' }),
      NOW,
    )!;
    expect(ld.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'INR',
      value: { '@type': 'QuantitativeValue', minValue: 20000, unitText: 'MONTH' },
    });
  });

  it('describes remote work with applicant location, not a fake address', () => {
    const ld = jobPostingJsonLd(job({ workplace: 'remote', location: '' }), NOW)!;
    expect(ld.jobLocationType).toBe('TELECOMMUTE');
    expect(ld.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'IN' });
    expect(ld).not.toHaveProperty('jobLocation');
  });

  it('emits nothing for an expired, closed or location-less listing', () => {
    expect(jobPostingJsonLd(job({ application_deadline: '2026-09-01' }), NOW)).toBeUndefined();
    expect(jobPostingJsonLd(job({ status: 'closed' }), NOW)).toBeUndefined();
    expect(jobPostingJsonLd(job({ location: '' }), NOW)).toBeUndefined();
    expect(jobPostingJsonLd(job({ published_at: null, created_at: undefined }), NOW)).toBeUndefined();
  });
});
