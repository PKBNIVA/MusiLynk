import type { Page, Request } from '@playwright/test';

// A stateful mocked API for the library / portfolios / resumes / review screens.
type Role = 'jobseeker' | 'employer';
export type Call = { method: string; path: string; body: unknown; actAs: string | null };
type Reply = { status?: number; body: unknown } | undefined;

const art = (a: string, b: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="6">${Array.from({ length: 24 }, (_, i) => `<line x1="${40 + i * 24}" x2="${40 + i * 24}" y1="${180 - ((i * 37) % 90)}" y2="${180 + ((i * 37) % 90)}"/>`).join('')}</g><text x="32" y="330" font-family="sans-serif" font-size="28" fill="#fff" fill-opacity=".85">${label}</text></svg>`;

export const MEDIA: Record<string, string> = {
  'blue.png': art('#6d28d9', '#0ea5e9', 'Blue in green'),
  'nh7.png': art('#be185d', '#f59e0b', 'Live at NH7'),
  'score.png': art('#0f766e', '#1e3a8a', 'Monsoon — film cue'),
};

export const item = (id: string, over: Record<string, unknown>) => ({
  id,
  kind: 'audio',
  type: 'audio',
  title: id,
  url: `https://media.musilynk.test/${id}.mp3`,
  visibility: 'public',
  tags: [],
  genres: [],
  roles: [],
  instruments: [],
  mediaMetadata: {},
  createdAt: '2025-01-01T00:00:00Z',
  ...over,
});

export function library() {
  return [
    item('blue', {
      title: 'Blue in green (trio take)',
      type: 'video',
      kind: 'video',
      url: 'https://media.musilynk.test/blue.png',
      mediaMetadata: { contentType: 'image/png' },
      genres: ['Jazz'],
      roles: ['Keyboardist'],
      instruments: ['Piano'],
      tags: ['studio'],
      year: 2024,
      featured: true,
      creditedAs: 'Keys',
    }),
    item('nh7', {
      title: 'Live at NH7 Weekender',
      type: 'live',
      kind: 'live',
      url: 'https://media.musilynk.test/nh7.png',
      mediaMetadata: { contentType: 'image/png' },
      genres: ['Rock', 'Indie'],
      roles: ['Keyboardist'],
      tags: ['live'],
      year: 2025,
    }),
    item('score', {
      title: 'Monsoon — OTT film cue',
      type: 'composition',
      kind: 'composition',
      url: 'https://media.musilynk.test/score.png',
      mediaMetadata: { contentType: 'image/png' },
      genres: ['Film score'],
      roles: ['Composer'],
      year: 2023,
    }),
    item('demo', { title: 'Untitled demo', url: 'https://soundcloud.example.invalid/riya/demo', year: 2022 }),
  ];
}

export const identities = [
  { type: 'user', id: 'qa-jobseeker', name: 'Riya Keys', key: 'user:qa-jobseeker' },
  { type: 'organization', id: 'org1', name: 'Riya Studios', key: 'organization:org1' },
  { type: 'act', id: 'act1', name: 'The Monsoon Collective', key: 'act:act1' },
];

const master = {
  headline: 'Keys player and composer for film and live',
  bio: 'Mumbai-based keys player. Twelve years of sessions, film cues and festival stages with indie and jazz acts.',
  city: 'Mumbai',
  genres: ['Jazz', 'Film score'],
  rates: { min: 6000, max: 9000, currency: 'INR', basis: 'session' },
};

export function portfolio(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    ownerType: 'user',
    ownerId: 'qa-jobseeker',
    ownerName: 'Riya Keys',
    title: 'Jazz sessions',
    purpose: 'session',
    ...master,
    overridden: [] as string[],
    master,
    rules: { any: { genres: ['Jazz', 'Blues'], roles: ['Keyboardist'] } },
    pinnedItemIds: [] as string[],
    excludedItemIds: [] as string[],
    itemOrder: [],
    visibility: 'public',
    slug: 'jazz-sessions-x7k2qa',
    isDefault: true,
    status: 'active',
    ...over,
  };
}

const withItems = (p: ReturnType<typeof portfolio>, lib = library()) => {
  const members = lib
    .filter((i) => !p.excludedItemIds.includes(i.id))
    .filter(
      (i) =>
        p.pinnedItemIds.includes(i.id) ||
        (i.genres as string[]).some((g) => ['Jazz', 'Blues'].includes(g)) ||
        (i.roles as string[]).includes('Keyboardist'),
    );
  return {
    ...p,
    itemCount: members.length,
    itemIds: members.map((i) => i.id),
    items: members.map((i) => ({ itemId: i.id, source: p.pinnedItemIds.includes(i.id) ? 'pinned' : 'rule', item: i })),
  };
};

export const careerEntries = [
  {
    id: 'c1',
    kind: 'experience',
    fields: {
      role: 'Keys, touring band',
      organization: 'The Local Train',
      location: 'India tour',
      current: true,
      description: 'Keys and synth programming for 60+ shows.',
    },
    startOn: '2021-03-01',
    endOn: null,
    tags: ['live'],
    position: 0,
  },
  {
    id: 'c2',
    kind: 'credit',
    fields: { title: 'Monsoon (OTT series)', role: 'Additional music', artist: 'Netflix India', year: 2023 },
    tags: ['film'],
    position: 0,
  },
  {
    id: 'c3',
    kind: 'education',
    fields: { institution: 'KM Music Conservatory', qualification: 'Diploma', field: 'Western keys' },
    startOn: '2012-01-01',
    endOn: '2014-01-01',
    tags: [],
    position: 0,
  },
  { id: 'c4', kind: 'skill', fields: { name: 'Ableton Live', level: 'expert' }, tags: [], position: 0 },
  { id: 'c5', kind: 'language', fields: { name: 'Hindi', proficiency: 'native' }, tags: [], position: 0 },
];

export function resume(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    title: 'Session CV',
    targetRole: 'Session keys',
    headline: master.headline,
    summary: master.bio,
    overridden: [],
    master: { headline: master.headline, summary: master.bio },
    rules: { everything: true, sort: 'newest' },
    pinnedEntryIds: [],
    excludedEntryIds: [],
    entryOrder: [],
    sectionOrder: [],
    isDefault: true,
    entryCount: 5,
    sections: [
      { kind: 'experience', entries: [{ ...careerEntries[0], source: 'rule' }] },
      { kind: 'credit', entries: [{ ...careerEntries[1], source: 'rule' }] },
      { kind: 'education', entries: [{ ...careerEntries[2], source: 'rule' }] },
      { kind: 'skill', entries: [{ ...careerEntries[3], source: 'rule' }] },
      { kind: 'language', entries: [{ ...careerEntries[4], source: 'rule' }] },
    ],
    ...over,
  };
}

export const suggestions = [
  {
    id: 's1',
    kind: 'include',
    status: 'pending',
    reason: 'Its title or description mentions jazz',
    payload: {},
    target: { type: 'portfolio', id: 'p2', title: 'Live performer' },
    subject: { type: 'portfolio_item', id: 'nh7', title: 'Live at NH7 Weekender' },
  },
  {
    id: 's2',
    kind: 'tags',
    status: 'pending',
    reason: 'Its description mentions film score and composer',
    payload: { genres: ['Film score'], roles: ['Composer'] },
    target: { type: 'portfolio_item', id: 'demo', title: 'Untitled demo' },
    subject: { type: 'portfolio_item', id: 'demo', title: 'Untitled demo' },
  },
];

export const job = {
  id: 'job-1',
  title: 'Session keys for a jazz EP',
  company: 'Riya Studios',
  location: 'Mumbai',
  workplace: 'on-site',
  status: 'published',
  type: 'Session',
  opportunity_kind: 'session',
  description: 'Record Rhodes and piano on a five-track jazz EP over two days in Bandra.',
  skills: ['Rhodes', 'Jazz harmony'],
  screeningQuestions: [],
  postedAs: { type: 'organization', id: 'org1', name: 'Riya Studios' },
};

/**
 * Signs in as a job seeker with the showcase API mocked. `overrides` answers first (return
 * undefined to fall through). Every request is recorded with its acting-as header.
 */
export async function signInShowcase(
  page: Page,
  overrides: (request: Request, path: string) => Reply = () => undefined,
  role: Role = 'jobseeker',
) {
  const calls: Call[] = [];
  const lib = library();
  let p1 = portfolio();
  const p2 = portfolio({
    id: 'p2',
    title: 'Live performer',
    purpose: 'live',
    rules: { all: { tags: ['live'] } },
    isDefault: false,
    visibility: 'link',
    slug: 'live-performer-q9w8e7',
  });
  let r1 = resume();
  let pending = [...suggestions];
  await page.addInitScript((r) => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem(`verse-tour-v2-${r}`, 'done');
  }, role);
  await page.route('https://media.musilynk.test/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    return MEDIA[name]
      ? route.fulfill({ contentType: 'image/svg+xml', body: MEDIA[name] })
      : route.fulfill({ status: 404, body: '' });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    const actAs = (await request.allHeaders())['x-verse-act-as'] ?? null;
    calls.push({ method: request.method(), path: `${path}${url.search}`, body, actAs });
    const json = (b: unknown, status = 200) => route.fulfill({ status, json: b });
    const custom = overrides(request, path);
    if (custom) return json(custom.body, custom.status);
    const m = request.method();
    if (path === '/me')
      return json({
        user: {
          id: `qa-${role}`,
          name: 'Riya Keys',
          email: 'riya@example.invalid',
          role,
          status: 'active',
          profileComplete: true,
        },
      });
    if (path === '/notifications/unread') return json({ unread: 0, unreadMessages: 0 });
    if (path === '/me/identities') return json({ identities });
    if (path === '/ai/status') return json({ enabled: false, tasks: [] });
    if (path === '/ai/autocomplete') {
      const q = url.searchParams.get('q') || '';
      const pool = ['Jazz', 'Jazz fusion', 'Keyboardist', 'Blues', 'Film score', 'Piano', 'Rhodes'];
      return json({
        suggestions: pool
          .filter((v) => v.toLowerCase().startsWith(q.toLowerCase()))
          .map((value) => ({ value, source: 'taxonomy' })),
      });
    }
    if (path === '/portfolio' && m === 'GET') return json({ items: lib });
    if (path === '/portfolio' && m === 'POST') {
      const created = item('new1', { ...(body as object), id: 'new1', kind: (body as { type: string }).type });
      lib.unshift(created);
      pending = [
        ...pending,
        {
          ...suggestions[0],
          id: 's9',
          reason: 'It has live but not original',
          subject: { type: 'portfolio_item', id: 'new1', title: created.title as string },
        },
      ];
      return json({ id: 'new1', item: created }, 201);
    }
    if (path === '/portfolios' && m === 'GET') {
      const list = [withItems(p1, lib), withItems(p2, lib)].map((p) =>
        p.id === 'p2' ? { ...p, itemIds: [...p.itemIds, 'new1'] } : { ...p, itemIds: [...p.itemIds, 'new1'] },
      );
      return json({ portfolios: list.map(({ items: _items, ...rest }) => rest), limit: 20 });
    }
    if (path === '/portfolios/draft')
      return json({
        draft: {
          title: 'Film scoring reel',
          purpose: 'film-scoring',
          rules: { everything: true, sort: 'featured', only: { genres: ['Film score'] } },
          pinnedItemIds: [],
          excludedItemIds: [],
          terms: { genres: ['Film score'] },
          items: [
            { itemId: 'score', title: 'Monsoon — OTT film cue', included: true, reason: 'Kept: matches Film score' },
            {
              itemId: 'demo',
              title: 'Untitled demo',
              included: true,
              reason: 'Kept: it does not state a genre, so nothing rules it out',
            },
            {
              itemId: 'blue',
              title: 'Blue in green (trio take)',
              included: false,
              reason: 'Removed: genres Jazz, not Film score',
            },
            {
              itemId: 'nh7',
              title: 'Live at NH7 Weekender',
              included: false,
              reason: 'Removed: genres Rock, Indie, not Film score',
            },
          ],
          summary: { total: 4, kept: 2, removed: 2 },
          note: null,
        },
      });
    if (path === '/portfolios' && m === 'POST')
      return json({ id: 'p3', portfolio: withItems(portfolio({ id: 'p3', ...(body as object) }), lib) }, 201);
    const pm = path.match(/^\/portfolios\/(p\d)(\/.*)?$/);
    if (pm) {
      const [, id, rest] = pm;
      const current = id === 'p2' ? p2 : p1;
      if (!rest && m === 'GET') return json({ portfolio: withItems(current, lib) });
      if (!rest && m === 'PATCH') {
        const b = body as Record<string, unknown>;
        const overridden = new Set(p1.overridden);
        for (const f of ['headline', 'bio', 'city', 'genres', 'rates'])
          if (f in b) b[f] === null ? overridden.delete(f) : overridden.add(f);
        p1 = { ...p1, ...b, overridden: [...overridden] } as typeof p1;
        for (const f of ['headline', 'bio', 'city', 'genres', 'rates'])
          if (!overridden.has(f)) (p1 as Record<string, unknown>)[f] = (master as Record<string, unknown>)[f];
        return json({ portfolio: withItems(p1, lib) });
      }
      if (rest === '/reset') {
        const fields = ((body as { fields?: string[] }).fields || []) as string[];
        p1 = { ...p1, overridden: p1.overridden.filter((f) => !fields.includes(f)) };
        for (const f of fields) (p1 as Record<string, unknown>)[f] = (master as Record<string, unknown>)[f];
        return json({ portfolio: withItems(p1, lib) });
      }
      const im = rest?.match(/^\/items\/(.+)$/);
      if (im) {
        const state = (body as { state: string }).state;
        const itemId = decodeURIComponent(im[1]);
        const pinned = p1.pinnedItemIds.filter((x) => x !== itemId);
        const excluded = p1.excludedItemIds.filter((x) => x !== itemId);
        if (state === 'pinned') pinned.push(itemId);
        if (state === 'excluded') excluded.push(itemId);
        p1 = { ...p1, pinnedItemIds: pinned, excludedItemIds: excluded };
        return json({ portfolio: withItems(p1, lib) });
      }
      if (rest === '/default') return json({ portfolio: withItems({ ...current, isDefault: true }, lib) });
    }
    if (path === '/public/portfolios/jazz-sessions-x7k2qa') {
      const {
        master: _m,
        rules: _r,
        pinnedItemIds: _p,
        excludedItemIds: _e,
        isDefault: _d,
        status: _s,
        ...pub
      } = withItems(p1, lib);
      return json({ portfolio: pub });
    }
    if (path.startsWith('/public/portfolios/')) return json({ error: 'Not found' }, 404);
    if (path === '/career-entries') return json({ entries: careerEntries, limit: 300 });
    if (path === '/resumes' && m === 'GET') return json({ resumes: [{ ...r1, sections: undefined }], limit: 20 });
    if (path === '/resumes/r1' && m === 'GET') return json({ resume: r1 });
    if (path === '/resumes/r1' && m === 'PATCH') {
      r1 = { ...r1, ...(body as object) };
      return json({ resume: r1 });
    }
    if (path === '/suggestions') {
      const status = url.searchParams.get('status') || 'pending';
      const list = status === 'all' ? pending : pending.filter((s) => s.status === 'pending');
      return json({ suggestions: list, pending: pending.filter((s) => s.status === 'pending').length });
    }
    if (path === '/suggestions/accept-all') {
      const accepted = pending.filter((s) => s.status === 'pending').map((s) => s.id);
      pending = pending.map((s) => ({ ...s, status: 'accepted' }));
      return json({ accepted, obsolete: [] });
    }
    const sm = path.match(/^\/suggestions\/(\w+)\/(accept|reject)$/);
    if (sm) {
      pending = pending.map((s) =>
        s.id === sm[1] ? { ...s, status: sm[2] === 'accept' ? 'accepted' : 'rejected' } : s,
      );
      return json({ suggestion: pending.find((s) => s.id === sm[1]), applied: true });
    }
    if (path === '/jobs/job-1' && m === 'GET') return json({ job });
    if (path === '/jobs/job-1/apply') return json({ id: 'app-1', status: 'Applied' }, 201);
    if (path === '/pages/organization/org1/jobs')
      return json({ page: { type: 'organization', id: 'org1', name: 'Riya Studios' }, jobs: [job] });
    return json({});
  });
  return { calls };
}
