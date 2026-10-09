import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ListSkeleton } from '../ListSkeleton';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ListSkeleton', () => {
  it('announces what is loading once and renders hidden placeholder cards at the requested size', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<ListSkeleton label="Loading bookings" count={4} cardClassName="h-36" />));
    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-label')).toBe('Loading bookings');
    expect(status?.textContent).toBe('Loading bookings…');
    const cards = host.querySelectorAll('[aria-hidden="true"] > div');
    expect(cards).toHaveLength(4);
    cards.forEach((card) => expect(card.className).toContain('h-36'));
    act(() => root.unmount());
  });

  it('defaults to six cards in the directory grid', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<ListSkeleton label="Loading acts" />));
    expect(host.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(6);
    expect(host.querySelector('[aria-hidden="true"]')?.className).toContain('lg:grid-cols-3');
    act(() => root.unmount());
  });
});
