import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileDraftReview } from '../ProfileDraftReview';
import type { DraftResult } from '../../../lib/linkImport';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const $$ = (selector: string) => Array.from(document.querySelectorAll(selector)) as HTMLElement[];

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
function typeInto(input: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const baseResult: DraftResult = {
  sources: [
    {
      provider: 'youtube',
      kind: 'channel',
      label: 'YouTube',
      url: 'https://youtube.com/@artist',
      title: 'Artist Channel',
      author: null,
      thumbnail: null,
    },
  ],
  draft: {
    headline: 'Session guitarist in Mumbai',
    bio: 'I play guitar for sessions and live shows.',
    roles: ['Artists & performers'],
    genres: ['Indie'],
    instruments: ['Acoustic Guitar'],
    city: 'Mumbai',
    yearsExperience: 5,
    credits: [{ text: 'toured with a famous band', source_url: 'https://youtube.com/@artist' }],
    items: [{ url: 'https://youtube.com/@artist', title: 'Artist Channel', caption: 'My YouTube channel' }],
  },
  aiUsed: true,
  provenance: { headline: 'https://youtube.com/@artist', city: 'https://youtube.com/@artist' },
};

describe('ProfileDraftReview', () => {
  it('renders the drafted fields and a source chip for a provenanced field', () => {
    act(() => root.render(<ProfileDraftReview result={baseResult} onUse={() => {}} onSkip={() => {}} />));
    expect(($('#draft-headline') as HTMLInputElement).value).toBe('Session guitarist in Mumbai');
    expect(($('#draft-bio') as HTMLTextAreaElement).value).toContain('I play guitar');
    expect(($('#draft-city') as HTMLInputElement).value).toBe('Mumbai');
    expect(($('#draft-years') as HTMLInputElement).value).toBe('5');
    expect(container.textContent).toContain('from YouTube');
    expect(container.textContent).toContain('We drafted this from your links');
  });

  it('shows the no-AI copy when aiUsed is false', () => {
    act(() =>
      root.render(<ProfileDraftReview result={{ ...baseResult, aiUsed: false }} onUse={() => {}} onSkip={() => {}} />),
    );
    expect(container.textContent).toContain('Drafted from your links without AI');
  });

  it('editing a field and pressing "Use this" passes the edited value, carrying genres/instruments/credits through unchanged', () => {
    const onUse = vi.fn();
    act(() => root.render(<ProfileDraftReview result={baseResult} onUse={onUse} onSkip={() => {}} />));

    const headline = $('#draft-headline') as HTMLInputElement;
    act(() => typeInto(headline, 'Edited headline'));

    const useButton = $('[data-testid="draft-use"]') as HTMLButtonElement;
    act(() => useButton.click());

    expect(onUse).toHaveBeenCalledTimes(1);
    const draft = onUse.mock.calls[0][0];
    expect(draft.headline).toBe('Edited headline');
    expect(draft.genres).toEqual(['Indie']);
    expect(draft.instruments).toEqual(['Acoustic Guitar']);
    expect(draft.credits).toEqual(baseResult.draft.credits);
  });

  it('"Skip" calls onSkip and never onUse', () => {
    const onUse = vi.fn();
    const onSkip = vi.fn();
    act(() => root.render(<ProfileDraftReview result={baseResult} onUse={onUse} onSkip={onSkip} />));
    act(() => ($('[data-testid="draft-skip"]') as HTMLButtonElement).click());
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('renders a work item with its title, caption and source', () => {
    act(() => root.render(<ProfileDraftReview result={baseResult} onUse={() => {}} onSkip={() => {}} />));
    const titleInput = $$('input[aria-label="Item 1 title"]')[0] as HTMLInputElement;
    expect(titleInput.value).toBe('Artist Channel');
    expect(container.textContent).toContain('YouTube');
  });

  it('a custom useLabel (the library dialog\'s "Add to my work") replaces the default button text', () => {
    act(() =>
      root.render(
        <ProfileDraftReview result={baseResult} onUse={() => {}} onSkip={() => {}} useLabel="Add to my work" />,
      ),
    );
    expect($('[data-testid="draft-use"]')?.textContent).toContain('Add to my work');
  });
});
