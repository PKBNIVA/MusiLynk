import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

import { FormatGlyph } from '../FormatGlyph';

describe('FormatGlyph', () => {
  it('renders a decorative svg per kind and falls back to job', () => {
    for (const kind of [
      'gig',
      'session',
      'audition',
      'tour',
      'teaching',
      'collaboration',
      'internship',
      'job',
      'unknown',
    ]) {
      show(<FormatGlyph kind={kind} size={24} />);
      const svg = host.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('width')).toBe('24');
    }
  });
  it('uses different icons for different kinds', () => {
    show(<FormatGlyph kind="gig" />);
    const gig = host.innerHTML;
    show(<FormatGlyph kind="tour" />);
    expect(host.innerHTML).not.toBe(gig);
    show(<FormatGlyph kind="nonsense" />);
    const fallback = host.innerHTML.replace('nonsense', 'job');
    show(<FormatGlyph kind="job" />);
    expect(host.innerHTML).toBe(fallback);
  });
});
