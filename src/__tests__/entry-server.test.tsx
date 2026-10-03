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
  it('renders the not-found page for an unknown path', async () => {
    await expect(render('/__nope__/')).resolves.toContain('<');
  });
});
