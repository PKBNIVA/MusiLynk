import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePageMeta } from '../PageMeta';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function TestPage({
  title,
  description,
  options,
}: {
  title?: string;
  description?: string;
  options?: Parameters<typeof usePageMeta>[2];
}) {
  usePageMeta(title, description, options);
  return null;
}

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

function meta(attr: 'name' | 'property', key: string) {
  return document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  document.head.querySelectorAll('meta,link[rel="canonical"],script[data-page-meta]').forEach((el) => el.remove());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.head.querySelectorAll('meta,link[rel="canonical"],script[data-page-meta]').forEach((el) => el.remove());
});

describe('usePageMeta', () => {
  it('creates title, description, canonical and og/twitter tags', () => {
    render(<TestPage title="Hello" description="World" options={{ canonicalPath: '/hello' }} />);
    expect(document.title).toContain('Hello');
    expect(meta('name', 'description')?.content).toBe('World');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/hello$/);
    expect(meta('property', 'og:title')?.content).toBe('Hello');
    expect(meta('property', 'og:site_name')?.content).toBe('Verse');
    expect(meta('name', 'twitter:card')?.content).toBe('summary_large_image');
  });

  it('strips the query string from the canonical path when none is given', () => {
    window.history.pushState({}, '', '/some/path?x=1');
    render(<TestPage title="T" description="D" />);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/some\/path$/);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).not.toContain('?');
  });

  it('restores previous tag values on unmount', () => {
    const descTag = document.createElement('meta');
    descTag.name = 'description';
    descTag.content = 'original';
    document.head.appendChild(descTag);
    const originalTitle = document.title;

    render(<TestPage title="Changed" description="Changed desc" />);
    expect(meta('name', 'description')?.content).toBe('Changed desc');

    act(() => root.unmount());
    expect(document.title).toBe(originalTitle);
    expect(meta('name', 'description')?.content).toBe('original');
  });

  it('toggles the robots meta tag for noindex and restores it after', () => {
    render(<TestPage title="Private" description="d" options={{ noindex: true }} />);
    expect(meta('name', 'robots')?.content).toBe('noindex, nofollow');
    act(() => root.unmount());
    expect(meta('name', 'robots')?.content).toBe('');
  });

  it('escapes </script> in JSON-LD output', () => {
    const payload = '</script><script>' + 'alert' + '(1)</script>';
    render(<TestPage title="X" description="d" options={{ jsonLd: { evil: payload } }} />);
    const script = document.querySelector('script[type="application/ld+json"][data-page-meta]');
    expect(script?.textContent).not.toContain('</script>');
    expect(script?.textContent).toContain('<\\/script>');
  });

  it('falls back to the default og image, and prefixes a relative image with the public URL', () => {
    render(<TestPage title="A" description="d" />);
    expect(meta('property', 'og:image')?.content).toMatch(/\/og-default\.png$/);

    render(<TestPage title="A" description="d" options={{ image: '/custom.png' }} />);
    expect(meta('property', 'og:image')?.content).toMatch(/\/custom\.png$/);
  });
});
