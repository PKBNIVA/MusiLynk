import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { Music } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageHeader } from '../PageHeader';
import { HelpCallout } from '../help/HelpCallout';
import { TourStrip } from '../ProductTour';
import { DemoBadge } from '../DemoBadge';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (el: ReactElement) => act(() => root.render(el));
const click = (el: Element | null) => act(() => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);

describe('PageHeader', () => {
  it('renders a one-line title, an optional hint and actions', () => {
    show(<PageHeader title="Find work" hint="Gigs, sessions, auditions and tours" actions={<button>Go</button>} />);
    expect(host.querySelector('h1')?.textContent).toBe('Find work');
    expect(host.querySelector('p')?.textContent).toBe('Gigs, sessions, auditions and tours');
    expect(button('Go')).toBeTruthy();
  });
  it('omits the hint and actions when not given', () => {
    show(<PageHeader title="Stage" />);
    expect(host.querySelector('p')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });
});

describe('HelpCallout', () => {
  const props = { id: 't', title: 'How it works', steps: [{ icon: Music, title: 'One', text: 'First step' }] };
  it('is collapsed by default and opens on demand, remembering the choice', () => {
    show(<HelpCallout {...props} />);
    expect(host.querySelector('[data-help-callout]')).toBeNull();
    click(button('How this works') ?? null);
    expect(host.querySelector('[data-help-callout="t"]')).not.toBeNull();
    expect(localStorage.getItem('verse_help_shown:t')).toBe('1');
    act(() => root.render(<div />));
    show(<HelpCallout {...props} />);
    expect(host.querySelector('[data-help-callout="t"]')).not.toBeNull();
    click(host.querySelector('[aria-label="Hide tips: How it works"]'));
    expect(host.querySelector('[data-help-callout]')).toBeNull();
    expect(localStorage.getItem('verse_help_shown:t')).toBeNull();
  });
});

describe('TourStrip', () => {
  const strip = (role: 'employer' | 'jobseeker') => (
    <MemoryRouter>
      <TourStrip role={role} />
    </MemoryRouter>
  );
  it('shows three cards, is dismissed with "Got it" and stays dismissed', () => {
    show(strip('employer'));
    expect(host.querySelectorAll('a')).toHaveLength(3);
    click(button('Got it') ?? null);
    expect(host.querySelector('[data-testid="tour-strip"]')).toBeNull();
    act(() => root.render(<div />));
    show(strip('employer'));
    expect(host.querySelector('[data-testid="tour-strip"]')).toBeNull();
  });
  it('renders for musicians', () => {
    show(strip('jobseeker'));
    expect(host.textContent).toContain('Find work');
  });
});

describe('DemoBadge', () => {
  it('is a small outline chip and hidden unless shown', () => {
    show(<DemoBadge show />);
    expect(host.querySelector('[data-testid="demo-badge"]')?.className).toContain('border-white/15');
    show(<DemoBadge />);
    expect(host.querySelector('[data-testid="demo-badge"]')).toBeNull();
  });
});
