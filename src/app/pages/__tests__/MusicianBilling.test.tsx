import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicianBilling from '../MusicianBilling';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Rao', photoUrl: null } }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MusicianBilling', () => {
  it('says Verse is free during the beta and shows nothing about hirer plans', () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <MusicianBilling />
        </MemoryRouter>,
      ),
    );
    expect(container.querySelector('[data-testid="free-during-beta"]')?.textContent).toContain('Free during beta');
    expect(container.querySelector('[data-testid="free-during-beta"] [data-testid="user-avatar"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/\b(Pro|Studio)\b|trial|upgrade/i);
  });
});
