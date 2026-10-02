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

import { WaveformStrip } from '../WaveformStrip';

describe('WaveformStrip', () => {
  it('draws 64 bars, dimmed by default and lit while playing', () => {
    show(<WaveformStrip peaks={[0.1, 0.9, 0.4]} />);
    expect(host.querySelectorAll('rect')).toHaveLength(64);
    expect(host.querySelectorAll('rect.fill-violet-300')).toHaveLength(0);
    show(<WaveformStrip peaks={[0.1, 0.9]} playing />);
    expect(host.querySelectorAll('rect.fill-violet-300')).toHaveLength(64);
    expect(host.querySelector('svg')?.getAttribute('data-playing')).toBe('true');
  });
  it('lights the played share when progress is given, clamped to 0-1', () => {
    show(<WaveformStrip peaks={[0.5]} progress={0.5} />);
    expect(host.querySelectorAll('rect.fill-violet-300')).toHaveLength(32);
    show(<WaveformStrip peaks={[0.5]} progress={9} />);
    expect(host.querySelectorAll('rect.fill-violet-300')).toHaveLength(64);
    show(<WaveformStrip peaks={[0.5]} progress={-1} />);
    expect(host.querySelectorAll('rect.fill-violet-300')).toHaveLength(0);
  });
  it('renders nothing but the frame for unusable peaks', () => {
    show(<WaveformStrip peaks={[]} />);
    expect(host.querySelectorAll('rect')).toHaveLength(0);
  });
});
