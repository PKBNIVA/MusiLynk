import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../app/App';
import { routes } from '../app/routes';
import { BRAND_NAME } from '../app/lib/brand';
import { PUBLIC_PAGE_META, clipDescription, documentTitle } from '../app/lib/siteMeta';
import { PRERENDERED_PATHS, render as renderHead } from '../../scripts/prerender-heads.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
);

const FAKE_INDEX =
  '<!doctype html><html><head><title>d</title><meta name="description" content="d"></head><body><div id="root"></div></body></html>';
const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
const attr = (html: string, re: RegExp) => decode(re.exec(html)?.[1] ?? '');

// The <head> baked at build time (scripts/prerender-heads.mjs) and the one usePageMeta sets after
// hydration must be the same words: both read src/app/lib/siteMeta.ts. This mounts each pre-rendered
// page in jsdom and diffs the document against the baked head.
describe('baked head vs. client head', () => {
  let root: Root | null = null;
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.title = '';
  });
  for (const path of PRERENDERED_PATHS as string[]) {
    it(`${path} sets the same title and description the HTML carries`, async () => {
      const meta = PUBLIC_PAGE_META[path];
      expect(meta, `${path} needs an entry in PUBLIC_PAGE_META`).toBeDefined();
      const baked = renderHead(FAKE_INDEX, path, [meta.title, meta.description]);
      const bakedTitle = attr(baked, /<title>([^<]*)<\/title>/);
      const bakedDescription = attr(baked, /<meta name="description" content="([^"]*)">/);
      expect(bakedTitle).toBe(documentTitle(meta.title, BRAND_NAME));
      expect(bakedDescription).toBe(clipDescription(meta.description));

      const host = document.createElement('div');
      document.body.appendChild(host);
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      root = createRoot(host);
      await act(async () => root!.render(<App router={router} />));
      // The page is a lazy chunk; its usePageMeta effect runs once it has loaded.
      for (let i = 0; i < 100 && document.title === ''; i += 1) await act(() => new Promise((r) => setTimeout(r, 20)));
      expect(document.title).toBe(bakedTitle);
      expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(bakedDescription);
      host.remove();
    });
  }
});
