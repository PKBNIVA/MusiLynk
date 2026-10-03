import { describe, expect, it } from 'vitest';
import { prerenderedRouteMatches } from '../prerender';

describe('prerenderedRouteMatches', () => {
  it('matches an exact path and a dynamic pattern, nothing without a marker', () => {
    expect(prerenderedRouteMatches('/', '/')).toBe(true);
    expect(prerenderedRouteMatches('/pricing', '/pricing')).toBe(true);
    expect(prerenderedRouteMatches('/pricing', '/pricing/')).toBe(true);
    expect(prerenderedRouteMatches('/hire/drummer/mumbai', '/hire/drummer/mumbai')).toBe(true);
    expect(prerenderedRouteMatches('/professionals/:id', '/professionals/user_1')).toBe(true);
    expect(prerenderedRouteMatches('/professionals/:id', '/professionals/shell.html')).toBe(true);
    expect(prerenderedRouteMatches(undefined, '/')).toBe(false);
    expect(prerenderedRouteMatches('', '/')).toBe(false);
  });
  it('refuses the home markup for another page, and a shell for another family or depth', () => {
    expect(prerenderedRouteMatches('/', '/search')).toBe(false);
    expect(prerenderedRouteMatches('/pricing', '/')).toBe(false);
    expect(prerenderedRouteMatches('/professionals/:id', '/acts/act_1')).toBe(false);
    expect(prerenderedRouteMatches('/professionals/:id', '/professionals')).toBe(false);
    expect(prerenderedRouteMatches('/professionals/:id', '/professionals/a/b')).toBe(false);
  });
});
