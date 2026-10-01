import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  actCard,
  cardTree,
  clip,
  defaultCard,
  loadCard,
  lowestRate,
  money,
  opportunityCard,
  parseRequest,
  professionalCard,
  respond,
  handle,
  staticFallback,
  safePhotoUrl,
} from '../../api/og/_card.ts';

const text = (node) =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(text).join('|')
      : node?.props
        ? text(node.props.children)
        : '';

describe('og helpers', () => {
  it('formats rupees with Indian grouping and other currencies with their code', () => {
    expect(money(5000)).toBe('₹5,000');
    expect(money(1250000)).toBe('₹12,50,000');
    expect(money(300, 'usd')).toBe('USD 300');
  });
  it('takes the lowest filled-in rate', () => {
    expect(lowestRate({ sessionRate: 8000, dayRate: '5000', showRate: 0, hourlyRate: null })).toBe(5000);
    expect(lowestRate({})).toBeNull();
  });
  it('clips long text and squeezes whitespace', () => {
    expect(clip('a  b\nc', 10)).toBe('a b c');
    expect(clip('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
  });
  it('accepts only https photo URLs', () => {
    expect(safePhotoUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(safePhotoUrl('http://cdn.example/a.jpg')).toBeUndefined();
    expect(safePhotoUrl('javascript:alert(1)')).toBeUndefined();
    expect(safePhotoUrl(null)).toBeUndefined();
  });
  it('reads type and id from the route path /api/og/<type>/<id>.png the share pages link to', () => {
    const parse = (path) => parseRequest(new URL(`https://x.test${path}`));
    expect(parse('/api/og/professional/abc-123.png')).toEqual({ type: 'professional', id: 'abc-123' });
    expect(parse('/api/og/opportunity/7f3a')).toEqual({ type: 'opportunity', id: '7f3a' });
    expect(parse('/api/og/act/a_b.PNG?id=ignored')).toEqual({ type: 'act', id: 'a_b' });
    expect(parse('/api/og/job/abc.png')).toBeNull();
    expect(parse('/api/og/act/..%2Fetc')).toBeNull();
  });
  it('reads type and id from the query, dropping a .png suffix and rejecting odd ids', () => {
    const parse = (q) => parseRequest(new URL(`https://x.test/api/og?${q}`));
    expect(parse('type=professional&id=abc-123.png')).toEqual({ type: 'professional', id: 'abc-123' });
    expect(parse('type=act&id=a_b')).toEqual({ type: 'act', id: 'a_b' });
    expect(parse('type=job&id=abc')).toBeNull();
    expect(parse('type=act')).toBeNull();
    expect(parse('type=act&id=../etc')).toBeNull();
    expect(parse('type=act&id=' + 'a'.repeat(65))).toBeNull();
  });
});

describe('cards', () => {
  const person = {
    name: 'Aarav Kulkarni',
    headline: 'Session drummer',
    roles: ['Drummer'],
    genres: ['Bollywood', 'Indie', 'Rock'],
    location: 'Mumbai',
    verified: true,
    verificationTier: 'verified_pro',
    sessionRate: 6000,
    dayRate: 9000,
    photoUrl: 'https://cdn.example/a.jpg',
  };
  it('a professional card: name, role, city, from-rate, tier and at most three chips', () => {
    const card = professionalCard('p1', person);
    expect(card).toMatchObject({
      title: 'Aarav Kulkarni',
      subtitle: 'Session drummer',
      kicker: 'Musician · Mumbai',
      monogram: 'AK',
    });
    expect(card.chips).toEqual(['Verified Pro', 'from ₹6,000', 'Bollywood']);
    expect(card.photoUrl).toBe('https://cdn.example/a.jpg');
    expect(card.shape).toBe('circle');
  });
  it('never uses a photo for a demo account', () => {
    expect(professionalCard('p1', { ...person, demo: true }).photoUrl).toBeUndefined();
    expect(
      actCard('a1', { name: 'Band', demo: true, photo_url: 'https://cdn.example/b.jpg' }).photoUrl,
    ).toBeUndefined();
  });
  it('a professional with no name has no card', () => {
    expect(professionalCard('p1', {})).toBeNull();
    expect(opportunityCard('j1', {})).toBeNull();
    expect(actCard('a1', {})).toBeNull();
  });
  it('an opportunity card: kind, company, place and a pay range', () => {
    const card = opportunityCard('j1', {
      title: 'Session guitarist',
      company: 'Blue Frog',
      type: 'session',
      location: 'Mumbai',
      compensation_min: 5000,
      compensation_max: 8000,
      employerVerified: true,
    });
    expect(card).toMatchObject({
      kicker: 'Opportunity · session',
      subtitle: 'Blue Frog',
      kind: 'session',
      shape: 'square',
    });
    expect(card.chips).toEqual(['Mumbai', '₹5,000–8,000', 'Verified hirer']);
    expect(opportunityCard('j2', { title: 'T', salary: 'Negotiable' }).chips).toEqual(['Negotiable']);
    expect(opportunityCard('j3', { title: 'T', compensation_min: 4000 }).chips).toEqual(['from ₹4,000']);
  });
  it('an act card: fee, lineup and genres', () => {
    const card = actCard('a1', {
      name: 'The Brass Co',
      tagline: 'Baraat brass',
      city: 'Pune',
      min_fee: 45000,
      lineup_size: 7,
      genres: ['Folk'],
      verified: true,
    });
    expect(card.kicker).toBe('Live act · Pune');
    expect(card.chips).toEqual(['Verified', 'from ₹45,000', '7 on stage']);
  });
  it('draws the text of the card into the element tree', () => {
    const tree = cardTree(professionalCard('p1', person));
    const drawn = text(tree);
    for (const part of ['Verse', 'Aarav Kulkarni', 'Session drummer', 'from ₹6,000', 'AK'])
      expect(drawn).toContain(part);
    expect(tree.props.style).toMatchObject({ width: 1200, height: 630 });
    expect(text(cardTree(defaultCard()))).toContain('Hire a verified musician');
  });
  it('shows a fetched photo instead of the art', () => {
    const tree = cardTree(professionalCard('p1', person), 'data:image/jpeg;base64,AAAA');
    expect(JSON.stringify(tree)).toContain('data:image/jpeg;base64,AAAA');
    expect(text(tree)).not.toContain('|AK');
  });
});

describe('respond', () => {
  const png = new Uint8Array([137, 80, 78, 71]).buffer;
  const make = (over = {}) => ({
    apiOrigin: 'https://api.test',
    fetchJson: vi.fn(async () => ({ professional: { name: 'Meera Iyer', photoUrl: 'https://cdn.example/m.jpg' } })),
    fetchImage: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
    render: vi.fn(async () => png),
    ...over,
  });
  const ask = (deps, query = 'type=professional&id=p1') => respond(new Request(`https://x.test/api/og?${query}`), deps);

  it('returns a cached PNG for a known id, fetching the public JSON', async () => {
    const deps = make();
    const res = await ask(deps);
    expect(deps.fetchJson).toHaveBeenCalledWith('https://api.test/api/public/talent/p1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(await res.arrayBuffer()).toEqual(png);
  });
  it('asks the right endpoint for each type', async () => {
    const deps = make({ fetchJson: vi.fn(async () => ({ job: { title: 'Gig' }, act: { name: 'Act' } })) });
    await ask(deps, 'type=opportunity&id=j1');
    await ask(deps, 'type=act&id=a1');
    expect(deps.fetchJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/api/jobs/j1',
      'https://api.test/api/public/acts/a1',
    ]);
    await expect(loadCard('act', 'a1', deps)).resolves.toMatchObject({ title: 'Act' });
  });
  it('falls back to the default card, briefly cached, for no id, an unknown id or a failed lookup', async () => {
    for (const [query, deps] of [
      ['', make()],
      ['type=professional&id=nope', make({ fetchJson: vi.fn(async () => null) })],
      ['type=professional&id=p1', make({ fetchJson: vi.fn(async () => Promise.reject(new Error('down'))) })],
      ['type=professional&id=p1', make({ fetchJson: vi.fn(async () => ({ professional: {} })) })],
    ]) {
      const res = await ask(deps, query);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
      expect(text(deps.render.mock.calls[0][0])).toContain('Hire a verified musician');
    }
  });
  it('draws the art when the photo cannot be fetched, or when the renderer cannot decode it', async () => {
    const noPhoto = make({ fetchImage: vi.fn(async () => Promise.reject(new Error('timeout'))) });
    await ask(noPhoto);
    expect(JSON.stringify(noPhoto.render.mock.calls[0][0])).not.toContain('data:image/jpeg');

    const render = vi.fn().mockRejectedValueOnce(new Error('bad image')).mockResolvedValue(png);
    const undecodable = make({ render });
    const res = await ask(undecodable);
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(render).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(render.mock.calls[0][0])).toContain('data:image/jpeg');
    expect(JSON.stringify(render.mock.calls[1][0])).not.toContain('data:image/jpeg');
  });
  it('ends on the default card if even the art fails to draw', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue(png);
    const res = await ask(make({ render }));
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    expect(render).toHaveBeenCalledTimes(3);
  });
});

describe('function glue', () => {
  it('handle() answers through the given renderer, using the API origin from the environment', async () => {
    const png = new Uint8Array([137, 80, 78, 71]).buffer;
    const render = vi.fn(async () => png);
    const fetchMock = vi.fn(async () => Response.json({ professional: { name: 'Meera Iyer' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OG_API_ORIGIN', 'https://api.example/');
    try {
      const res = await handle(new Request('https://x.test/api/og/professional/p1.png'), render);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/api/public/talent/p1');
      expect(text(render.mock.calls[0][0])).toContain('Meera Iyer');

      fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
      const missing = await handle(new Request('https://x.test/api/og/professional/gone.png'), render);
      expect(missing.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it('staticFallback() sends the visitor to the static default card', () => {
    const res = staticFallback(new Request('https://verse.example/api/og/act/a1.png'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://verse.example/og-default.png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
  });
});

describe('deploy shape', () => {
  // vitest runs from the repo root.
  const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
  it('imports @vercel/og statically from a Node function, and lists it in dependencies', () => {
    const fn = read('api/og/[type]/[id].ts');
    expect(fn).toMatch(/^import \{ ImageResponse \} from '@vercel\/og';$/m);
    expect(fn).not.toMatch(/import\(/);
    expect(fn).not.toMatch(/runtime:\s*'edge'/);
    expect(JSON.parse(read('package.json')).dependencies['@vercel/og']).toBeTruthy();
  });
  it('uses .js extensions on relative imports, which Node ESM needs once the function is compiled', () => {
    for (const file of ['api/og/[type]/[id].ts', 'api/og/_card.ts']) {
      const relative = [...read(file).matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]);
      expect(relative.length).toBeGreaterThan(0);
      for (const path of relative) expect(path, `${file} imports ${path}`).toMatch(/\.js$/);
    }
  });
  it('lets /api/og/<type>/<id>.png reach the function instead of a rewrite or the SPA fallback', () => {
    const { rewrites } = JSON.parse(read('vercel.json'));
    const path = '/api/og/professional/abc.png';
    const hit = rewrites.filter(({ source }) => new RegExp(`^${source.replace(/:\w+/g, '[^/]+')}$`).test(path));
    expect(hit).toEqual([]);
  });
});
