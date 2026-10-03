// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from '../entry-server';

// The build-time pre-render (scripts/prerender-heads.mjs) renders these in Node with no DOM and no API.
describe('entry-server render', () => {
  it('renders the landing page with its heading, the hero picture and no loading fallback', async () => {
    const html = await render('/');
    expect(html).toContain('Hire a verified musician for your session or gig');
    expect(html).toContain('/img/veena-concert-1200.avif 1200w');
    expect(html).toContain('data-testid="landing-hero"');
    expect(html).not.toContain('>Loading<'); // PublicPageLoading, the lazy-chunk fallback
    // The auth-aware header renders its loading state, exactly as the browser's first render does.
    expect(html).not.toContain('Sign in');
  });
  it('renders a hire page heading from the slugs before the API answers', async () => {
    const html = await render('/hire/drummer/mumbai');
    expect(html).toContain('Hire a verified drummer in Mumbai');
    expect(html).toContain('Loading…');
  });
  it('renders a record shell as the static frame plus its loading state, whatever the id', async () => {
    const a = await render('/professionals/shell');
    const b = await render('/professionals/user_42');
    expect(a).toBe(b);
    expect(a).toMatch(/role="status">Loading .*profile/);
  });
  it('bakes nothing that depends on the build-time clock, the query string or storage', async () => {
    const html = await render('/urgent');
    expect(html).toContain('Find a verified musician, fast');
    // No datetime-local value or spelled-out date: the form takes "tomorrow, 6 pm" after mount.
    expect(html).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
    expect(html).not.toMatch(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{4}\b/);
    expect(html.replace(/<svg[\s\S]*?<\/svg>/g, '')).not.toMatch(/\b(20\d\d)\b/); // no year outside the icons' SVG namespace
    // The same HTML whatever the query string: filters and promo codes are applied after hydration.
    expect(await render('/music-professionals?role=drummer&location=Mumbai')).toBe(
      await render('/music-professionals'),
    );
    expect(await render('/pricing?code=FEST10&interval=annual')).toBe(await render('/pricing'));
    expect(await render('/urgent?role=Drummer&city=Mumbai')).toBe(html);
  });
  it('renders the not-found page for an unknown path', async () => {
    await expect(render('/__nope__/')).resolves.toContain('<');
  });
});
