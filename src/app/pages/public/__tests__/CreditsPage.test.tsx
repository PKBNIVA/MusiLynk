import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return { ...actual, apiGet: vi.fn().mockResolvedValue({}) };
});
import { AuthProvider } from '../../../lib/authContext';
import CreditsPage from '../CreditsPage';
import { IMAGE_CREDITS, creditLine } from '../imageCredits';

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

const ROOT = join(__dirname, '../../../../..');
const ALLOWED = ['CC0', 'Public domain', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0'];

describe('photo credits', () => {
  it('lists every photograph with author, licence and a Commons source', async () => {
    const router = createMemoryRouter([{ path: '/credits', element: <CreditsPage /> }], {
      initialEntries: ['/credits'],
    });
    await act(async () =>
      root.render(
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>,
      ),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Photo credits');
    const items = container.querySelectorAll('main li');
    expect(items).toHaveLength(IMAGE_CREDITS.length);
    const first = items[0];
    expect(first.textContent).toContain(IMAGE_CREDITS[0].author);
    expect(first.querySelector('img')?.getAttribute('srcset')).toContain(`/img/${IMAGE_CREDITS[0].file}-800.webp 800w`);
    expect(first.querySelector('img')?.getAttribute('alt')).toBe(IMAGE_CREDITS[0].alt);
    const source = first.querySelector('a[href^="https://commons.wikimedia.org/wiki/File:"]');
    expect(source?.getAttribute('rel')).toContain('noopener');
  });

  it('formats a credit line with the place when there is one', () => {
    const base = IMAGE_CREDITS[0];
    expect(creditLine({ ...base, title: 'T', author: 'A', licence: 'CC0', place: '' })).toBe('“T” by A, CC0');
    expect(creditLine({ ...base, title: 'T', author: 'A', licence: 'CC0', place: 'Goa' })).toBe('“T” by A, CC0, Goa');
    expect(creditLine({ ...base, title: 'Sarod concert (1).JPG', author: 'A', licence: 'CC0', place: '' })).toBe(
      '“Sarod concert (1)” by A, CC0',
    );
  });
});

describe('public/img', () => {
  const imgDir = join(ROOT, 'public/img');

  it('has an 800 and a 1600 variant for every credit and no uncredited files', () => {
    const expected = IMAGE_CREDITS.flatMap((c) => [`${c.file}-800.webp`, `${c.file}-1600.webp`]).sort();
    expect(readdirSync(imgDir).sort()).toEqual(expected);
  });

  it('keeps the set under 4 MB with each 1600 variant at most 160 KB', () => {
    const files = readdirSync(imgDir);
    expect(files.reduce((sum, f) => sum + statSync(join(imgDir, f)).size, 0)).toBeLessThan(4 * 1024 * 1024);
    for (const f of files.filter((name) => name.endsWith('-1600.webp'))) {
      expect(statSync(join(imgDir, f)).size, f).toBeLessThanOrEqual(160 * 1024);
    }
  });

  it('has between 20 and 30 photographs', () => {
    expect(IMAGE_CREDITS.length).toBeGreaterThanOrEqual(20);
    expect(IMAGE_CREDITS.length).toBeLessThanOrEqual(30);
  });

  it('only uses licences the plan allows, with a Commons source and no duplicates', () => {
    const files = new Set<string>();
    for (const c of IMAGE_CREDITS) {
      expect(ALLOWED, c.file).toContain(c.licence);
      expect(c.sourceUrl, c.file).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(c.author.length, c.file).toBeGreaterThan(1);
      expect(c.width, c.file).toBe(1600);
      expect(c.height / c.width, c.file).toBeLessThan(1);
      expect(files.has(c.file)).toBe(false);
      files.add(c.file);
    }
    // CC BY-SA only where the subject had no CC0 / public-domain / CC BY candidate of any quality.
    expect(IMAGE_CREDITS.filter((c) => c.licence.startsWith('CC BY-SA')).map((c) => c.file)).toEqual([
      'carnatic-vocalist',
      'college-fest',
      'wedding-band',
    ]);
  });

  it('matches docs/IMAGE_CREDITS.md row for row', () => {
    const doc = join(ROOT, 'docs/IMAGE_CREDITS.md');
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, 'utf8');
    for (const c of IMAGE_CREDITS) {
      const row = text.split('\n').find((line) => line.startsWith(`| \`${c.file}\` |`));
      expect(row, c.file).toBeDefined();
      expect(row).toContain(c.author);
      expect(row).toContain(c.licence);
      expect(row).toContain(c.sourceUrl);
    }
    expect(text.split('\n').filter((line) => /^\| `/.test(line))).toHaveLength(IMAGE_CREDITS.length);
  });
});
