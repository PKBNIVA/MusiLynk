import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TalentFacets, type FacetKey } from '../TalentFacets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const empty: Record<FacetKey, string> = { language: '', eventType: '', genre: '', budgetMax: '' };

function render(values = empty) {
  const update = vi.fn(() => true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(<TalentFacets values={values} update={update} />));
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
  return { host, update, button };
}

describe('TalentFacets', () => {
  it('starts collapsed and opens with the four facet groups', () => {
    const { host, button } = render();
    expect(host.querySelector('[role="group"]')).toBeNull();
    act(() => button('More filters').click());
    expect([...host.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual([
      'Language',
      'Event',
      'Genre',
      'Budget',
    ]);
  });

  it('is open when a facet is already chosen, and pressing a chip sets or clears it', () => {
    const { host, update, button } = render({ ...empty, genre: 'Ghazal' });
    expect(host.textContent).toContain('More filters (1)');
    expect(button('Ghazal').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Ghazal').click());
    expect(update).toHaveBeenLastCalledWith({ genre: '' });
    act(() => button('Hindi').click());
    expect(update).toHaveBeenLastCalledWith({ language: 'Hindi' });
    act(() => button('Up to ₹10,000').click());
    expect(update).toHaveBeenLastCalledWith({ budgetMax: '10000' });
  });
});
