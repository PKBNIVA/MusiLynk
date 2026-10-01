import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { JobCard } from '../JobCard';
import type { Job } from '../../lib/apiTypes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const job = (over: Partial<Job> = {}) =>
  ({
    id: 'j1',
    title: 'Studio session guitarist',
    company: 'Riya Studios',
    location: 'Mumbai',
    workplace: 'hybrid',
    genre: 'Jazz',
    skills: ['Guitar', 'Arranging'],
    opportunity_kind: 'session',
    compensation_min: 25000,
    compensation_max: 55000,
    compensation_period: 'project',
    applicationsCount: 1,
    demo: true,
    ...over,
  }) as Job;

function render(j: Job, compact = false) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    createRoot(host).render(
      <MemoryRouter>
        <JobCard job={j} to="/x" index={0} compact={compact} />
      </MemoryRouter>,
    ),
  );
  return host;
}

describe('JobCard', () => {
  it('shows glyph, title, demo after the title, pay, one skill max and applicants', () => {
    const host = render(job());
    expect(host.querySelector('[data-glyph="session"]')).toBeTruthy();
    const h2 = host.querySelector('h2') as HTMLElement;
    expect(h2.textContent).toBe('Studio session guitarist');
    expect(h2.nextElementSibling?.getAttribute('data-testid')).toBe('demo-badge');
    expect(host.textContent).toContain('Riya Studios');
    expect(host.textContent).toContain('Mumbai · Hybrid');
    expect(host.querySelector('.text-emerald-200')?.textContent).toBe('₹25,000–55,000 / project');
    expect(host.textContent).toContain('1 applicant');
    expect(host.textContent).not.toContain('Arranging');
  });
  it('draws generated cover art keyed by the job, with the kind glyph on it', () => {
    const host = render(job({ id: 'j9' }));
    const cover = host.querySelector('[data-testid="job-cover"]');
    expect(cover?.querySelector('[data-testid="cover-art"]')).toBeTruthy();
    expect(cover?.querySelector('[data-glyph="session"]')).toBeTruthy();
  });
  it('keeps undisclosed pay muted and compact shows only title, company and pay', () => {
    const host = render(job({ compensation_min: null, compensation_max: null, demo: false }), true);
    expect(host.textContent).toContain('Pay not disclosed');
    expect(host.querySelector('.text-emerald-200')).toBeNull();
    expect(host.textContent).not.toContain('applicant');
    expect(host.textContent).not.toContain('Jazz');
    expect(host.textContent).not.toContain('Mumbai');
  });
});
