import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (el: ReactElement) => act(() => root.render(<MemoryRouter>{el}</MemoryRouter>));

import { PlayChip, providerOf, truncateTitle } from '../PlayChip';
import type { PortfolioItem } from '../../../lib/apiTypes';

const sample = (over: Partial<PortfolioItem> = {}): PortfolioItem => ({
  id: 's1',
  kind: 'audio',
  type: 'audio',
  title: 'A very long title for a live session recording',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ...over,
});

describe('PlayChip', () => {
  it('truncates the title and shows the provider', () => {
    expect(truncateTitle('short')).toBe('short');
    expect(truncateTitle('x'.repeat(40)).length).toBe(22);
    show(<PlayChip sample={sample()} />);
    const b = host.querySelector('button') as HTMLButtonElement;
    expect(b.getAttribute('aria-label')).toBe(`Play ${sample().title}`);
    expect(b.textContent).toContain('YouTube');
    expect(b.textContent).toContain('…');
  });
  it('names a plain link by its host', () => {
    expect(providerOf({ url: 'https://www.example.com/x' })).toBe('example.com');
  });
  it('shows a thumbnail when present', () => {
    show(<PlayChip sample={sample({ thumbnailUrl: 'https://img.test/a.jpg' })} />);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://img.test/a.jpg');
  });
  it('opens the player dialog on click', () => {
    const onOpen = vi.fn();
    show(<PlayChip sample={sample()} onOpen={onOpen} />);
    act(() =>
      (host.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onOpen).toHaveBeenCalled();
    expect(document.body.querySelector('[role=dialog]')).toBeTruthy();
    expect(document.body.querySelector('[data-media-kind]')).toBeTruthy();
  });
});
