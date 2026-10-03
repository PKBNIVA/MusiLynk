import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// brand/logo/ is the one source of the logo; everything else is generated from it by
// `npm run brand:build`. These tests fail when a source changed without rebuilding, or when an
// output was edited by hand.
const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('brand/logo build', () => {
  it('has every committed vector output and the TS module in step with the sources', () => {
    const output = execFileSync(process.execPath, ['scripts/brand/build-logo.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('up to date');
  });

  it('keeps mark.svg a currentColor symbol on the 100x100 grid', () => {
    const svg = read('brand/logo/mark.svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/stroke=|<mask|<clipPath/);
  });

  it('serves the generated mark and no trace of the previous one', () => {
    for (const file of [
      'public/favicon.svg',
      'public/musilynk-mark.svg',
      'api/_lib/og.ts',
      'src/app/components/BrandMark.tsx',
    ]) {
      const text = read(file);
      expect(text, file).not.toMatch(/M15 72H22C28 72|#f0abfc|#c026d3/i);
    }
    const config = JSON.parse(read('brand/logo/logo.config.json'));
    expect(read('public/musilynk-mark.svg')).toContain(config.tile.gradientFrom);
    expect(JSON.parse(read('backend/config/brand_logo.json')).tileColor).toBe(config.tile.flat);
  });
});
