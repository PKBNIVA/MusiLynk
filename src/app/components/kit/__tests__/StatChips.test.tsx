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

import { StatChips } from '../StatChips';

describe('StatChips', () => {
  it('renders one chip per item', () => {
    show(
      <StatChips
        items={[
          { label: 'applications', value: 3 },
          { label: 'saved', value: 0 },
        ]}
      />,
    );
    const chips = Array.from(host.querySelectorAll('span')).map((s) => s.textContent);
    expect(chips).toEqual(['3 applications', '0 saved']);
  });
});
