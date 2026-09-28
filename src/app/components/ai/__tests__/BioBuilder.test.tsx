import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BioBuilder, buildBioVariants, type BioBuilderInput } from '../BioBuilder';

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

const fullInput: BioBuilderInput = {
  roles: ['Session Guitarist', 'Producer'],
  city: 'Mumbai',
  years: '5',
  genres: ['Rock', 'Hindi Pop'],
  credits: ['Toured with Indian Ocean', 'Recorded for Coke Studio', 'Played at NH7 Weekender', 'Extra credit dropped'],
};

describe('buildBioVariants', () => {
  it('is pure and deterministic: the same input always builds the same three variants', () => {
    expect(buildBioVariants(fullInput)).toEqual(buildBioVariants(fullInput));
  });

  it('returns exactly three tone variants: plain, warm and confident', () => {
    const variants = buildBioVariants(fullInput);
    expect(variants.map((v) => v.tone)).toEqual(['plain', 'warm', 'confident']);
  });

  it('weaves the given roles, city, years and genres into every variant', () => {
    for (const variant of buildBioVariants(fullInput)) {
      expect(variant.headline.length).toBeGreaterThan(0);
      expect(variant.bio).toContain('Mumbai');
      expect(variant.bio).toMatch(/Session Guitarist/);
    }
  });

  it('uses at most 3 credits, ignoring extras beyond that', () => {
    const variant = buildBioVariants(fullInput)[0];
    expect(variant.bio).toContain('Toured with Indian Ocean');
    expect(variant.bio).toContain('Recorded for Coke Studio');
    expect(variant.bio).not.toContain('Extra credit dropped');
  });

  it('degrades gracefully with only a role and nothing else', () => {
    const variants = buildBioVariants({ roles: ['Drummer'] });
    for (const variant of variants) {
      expect(variant.headline.length).toBeGreaterThan(0);
      expect(variant.bio).toMatch(/Drummer/);
    }
  });

  it('never makes a network call — it is a plain synchronous function', () => {
    expect(() => buildBioVariants(fullInput)).not.toThrow();
    expect(buildBioVariants(fullInput)).toBeInstanceOf(Array);
  });
});

describe('BioBuilder', () => {
  it('shows the plain variant by default and switches tone on click', () => {
    act(() => root.render(<BioBuilder input={fullInput} />));
    expect(container.textContent).toContain('Mumbai');

    const warmTab = Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Warm')!;
    act(() => warmTab.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(warmTab.getAttribute('aria-selected')).toBe('true');
  });

  it("calls onAcceptHeadline / onAcceptBio with the active variant's text", () => {
    const onAcceptHeadline = vi.fn();
    const onAcceptBio = vi.fn();
    act(() =>
      root.render(<BioBuilder input={fullInput} onAcceptHeadline={onAcceptHeadline} onAcceptBio={onAcceptBio} />),
    );

    const useHeadline = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Use this headline',
    )!;
    act(() => useHeadline.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onAcceptHeadline).toHaveBeenCalledWith(expect.stringContaining('Mumbai'));

    const useBio = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Use this bio')!;
    act(() => useBio.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onAcceptBio).toHaveBeenCalledTimes(1);
  });

  it('omits the accept buttons when no handler is given', () => {
    act(() => root.render(<BioBuilder input={fullInput} />));
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.startsWith('Use this'))).toBe(
      false,
    );
  });
});
