import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from '../BrandMark';
import {
  BRAND_MARK_ON_DARK,
  BRAND_MARK_ON_LIGHT,
  BRAND_MARK_PATHS,
  BRAND_MARK_VIEWBOX,
} from '../../lib/brandMark.generated';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return root;
}
afterEach(() => container.remove());

describe('BrandMark', () => {
  it('draws the glyph from the generated module, with the name as live text', () => {
    render(<BrandMark />);
    const glyph = container.querySelector('[data-testid="brand-glyph"]');
    expect(glyph?.getAttribute('viewBox')).toBe(BRAND_MARK_VIEWBOX);
    expect(glyph?.getAttribute('fill')).toBe(BRAND_MARK_ON_DARK);
    expect([...(glyph?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('d'))).toEqual(BRAND_MARK_PATHS);
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('MusiLynk');
  });

  it('uses the light-background colour when not inverse', () => {
    render(<BrandMark inverse={false} compact />);
    expect(container.querySelector('[data-testid="brand-glyph"]')?.getAttribute('fill')).toBe(BRAND_MARK_ON_LIGHT);
    expect(container.textContent).not.toContain('music works here');
  });
});
