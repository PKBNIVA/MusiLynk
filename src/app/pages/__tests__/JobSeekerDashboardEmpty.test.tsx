import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const answers: Record<string, unknown> = {};
vi.mock('../../lib/api', () => ({
  apiGet: (path: string) => (path in answers ? Promise.resolve(answers[path]) : Promise.reject(new Error(path))),
}));
vi.mock('../../lib/authContext', () => ({ useAuth: () => ({ user: { name: 'Asha Rao', verified: false } }) }));
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../components/ProductTour', () => ({ TourStrip: () => null }));
vi.mock('../../components/landing/WelcomeNextStep', () => ({ WelcomeNextStep: () => null }));

import JobSeekerDashboard from '../JobSeekerDashboard';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const key of Object.keys(answers)) delete answers[key];
  answers['/dashboard'] = { applications: 0, interviews: 0, saved: 0, recommendedJobs: [], profileScore: 90 };
  answers['/conversations'] = { conversations: [] };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <JobSeekerDashboard />
      </MemoryRouter>,
    );
  });
  await act(async () => undefined);
}

describe('JobSeekerDashboard empty state', () => {
  it('asks for a work sample only when there is none', async () => {
    answers['/portfolio'] = { items: [] };
    answers['/availability'] = { windows: [] };
    await render();
    const empty = container.querySelector('[data-testid="empty-state"]');
    expect(empty?.textContent).toContain('Add a work sample');
  });

  it('moves on to availability once a sample exists, then to finding work', async () => {
    answers['/portfolio'] = { items: [{ id: 'w1' }] };
    answers['/availability'] = { windows: [] };
    await render();
    let empty = container.querySelector('[data-testid="empty-state"]');
    expect(empty?.textContent).not.toContain('Add a work sample');
    expect(empty?.textContent).toContain('Set availability');

    act(() => root.unmount());
    root = createRoot(container);
    answers['/availability'] = { windows: [{ id: 'a1' }] };
    await render();
    empty = container.querySelector('[data-testid="empty-state"]');
    expect(empty?.textContent).toContain('Find work');
    expect(empty?.textContent).not.toContain('Add a work sample');
  });
});
