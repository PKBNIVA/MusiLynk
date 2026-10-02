import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reviews from '../Reviews';
import { apiGet } from '../../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../lib/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../components/ReportDialog', () => ({ ReportDialog: () => null }));
vi.mock('../../components/ui/app-select', () => ({
  AppSelect: (props: { 'aria-label'?: string; value: string }) => (
    <span data-testid={`select-${props['aria-label']}`}>{props.value}</span>
  ),
}));

const employer = (id: string) => ({ id, name: `Hirer ${id}`, role: 'employer', companyName: `Company ${id}` });
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve)));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(url: string, data: { reviews?: unknown[]; eligibleEmployers?: unknown[] }) {
  vi.mocked(apiGet).mockResolvedValue(data);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Reviews />
      </MemoryRouter>,
    ),
  );
  await flush();
}
const selected = () => container.querySelector('[data-testid="select-Hirer"]')?.textContent;

describe('Reviews', () => {
  it('pre-selects the hirer named by the employerId link the notification sends', async () => {
    await mount('/jobseeker/reviews?employerId=e2', {
      reviews: [],
      eligibleEmployers: [employer('e1'), employer('e2')],
    });
    expect(selected()).toBe('e2');
  });

  it('falls back to the first eligible hirer when employerId is missing or not eligible', async () => {
    await mount('/jobseeker/reviews?employerId=nobody', {
      reviews: [],
      eligibleEmployers: [employer('e1'), employer('e2')],
    });
    expect(selected()).toBe('e1');
  });

  it('with nothing yet shows the scene empty state with one Find work action and the fill-later note', async () => {
    await mount('/jobseeker/reviews', { reviews: [], eligibleEmployers: [] });
    const empty = container.querySelector('[data-testid="empty-state"]');
    expect(empty?.querySelector('svg')).not.toBeNull();
    expect(empty?.textContent).toContain('line up your first booking');
    const actions = empty?.querySelectorAll('a');
    expect(actions).toHaveLength(1);
    expect(actions?.[0].textContent).toBe('Find work');
    expect(actions?.[0].getAttribute('href')).toBe('/jobseeker/jobs');
    expect(container.querySelector('[data-testid="reviews-fill-later"]')).not.toBeNull();
  });
});
