import type { Page, Route } from '@playwright/test';

// A mocked API for the landing page and the two-minute sign-up (/join/*). Records what the page
// sends, answers link previews from fixtures, and "creates" the account on register or code verify.

const thumb = (from: string, to: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><polygon points="140,60 140,120 190,90" fill="white" opacity=".85"/></svg>`,
  )}`;

export const YOUTUBE = 'https://www.youtube.com/watch?v=qa-sangeet';
export const SOUNDCLOUD = 'https://soundcloud.com/riya-desai/blue-frog-live';
export const SPOTIFY = 'https://open.spotify.com/track/qa-jingle';

export const PREVIEWS: Record<string, Record<string, unknown>> = {
  [YOUTUBE]: {
    provider: 'youtube',
    kind: 'video',
    label: 'YouTube',
    url: YOUTUBE,
    title: 'Live at a sangeet, Bandra (drum cam)',
    author: 'Riya Desai',
    thumbnail: thumb('#a21caf', '#0f766e'),
  },
  [SOUNDCLOUD]: {
    provider: 'soundcloud',
    kind: 'audio',
    label: 'SoundCloud',
    url: SOUNDCLOUD,
    title: 'Blue Frog live set',
    author: 'Riya Desai',
    thumbnail: thumb('#7c3aed', '#f97316'),
  },
  [SPOTIFY]: {
    provider: 'spotify',
    kind: 'audio',
    label: 'Spotify',
    url: SPOTIFY,
    title: null,
    author: null,
    thumbnail: null,
  },
};

export interface SignupCalls {
  previews: string[];
  registers: Record<string, unknown>[];
  codeRequests: Record<string, unknown>[];
  starters: Record<string, unknown>[];
}

export async function mockSignupApi(page: Page, opts: { stats?: Record<string, unknown> } = {}) {
  const calls: SignupCalls = { previews: [], registers: [], codeRequests: [], starters: [] };
  let account: Record<string, unknown> | null = null;
  let links: Array<Record<string, string>> = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '/api');
    const method = request.method();
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = () => (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const makeUser = (data: Record<string, unknown>, role: string) => ({
      id: 'qa-new-user',
      name: data.name ?? 'Riya Desai',
      email: data.email,
      role,
      status: 'active',
      profileComplete:
        role === 'jobseeker' ? Boolean((data.roles as string[] | undefined)?.length) : Boolean(data.companyName),
      headline: data.headline ?? null,
      location: data.city ?? null,
      companyName: data.companyName ?? null,
      verified: false,
    });

    if (path === '/api/me')
      return account ? json(200, { user: account }) : json(401, { error: 'Authentication required' });
    if (path === '/api/auth/methods') return json(200, { signInCodes: true, password: true, emailDelivery: false });
    if (path === '/api/public/stats') return json(200, opts.stats ?? {});
    if (path === '/api/ai/status') return json(200, { enabled: false, tasks: [] });
    if (path === '/api/ai/autocomplete') return json(200, { suggestions: [] });
    if (path === '/api/link-previews' && method === 'POST') {
      const url = String(body().url);
      calls.previews.push(url);
      if (url.includes('private')) return json(422, { error: 'That link can’t be previewed.', code: 'INVALID_URL' });
      return json(
        200,
        PREVIEWS[url] ?? {
          provider: 'link',
          kind: 'link',
          label: 'Link',
          url,
          title: null,
          author: null,
          thumbnail: null,
        },
      );
    }
    if (path === '/api/auth/register' && method === 'POST') {
      const data = body();
      calls.registers.push(data);
      account = makeUser(data, String(data.role));
      links = ((data.links as Array<Record<string, string>> | undefined) ?? []).map((link, index) => ({
        id: `item-${index}`,
        title: link.title ?? 'Work sample',
        type: String(PREVIEWS[link.url]?.kind ?? 'link'),
        thumbnailUrl: link.thumbnail ?? '',
      }));
      return json(201, { user: account, accessToken: 'qa-new-token', verificationRequired: true });
    }
    if (path === '/api/auth/otp/request') {
      calls.codeRequests.push(body());
      return json(200, { ok: true, message: 'sent', expiresIn: 600, debugCode: '482913' });
    }
    if (path === '/api/auth/otp/verify') {
      const request = calls.codeRequests.at(-1) ?? {};
      account = makeUser({ ...request }, String(request.role ?? 'jobseeker'));
      return json(200, { user: account, accessToken: 'qa-new-token' });
    }
    if (path === '/api/onboarding/starter') {
      const data = body();
      calls.starters.push(data);
      account = { ...makeUser({ ...account, ...data }, String(account?.role)), profileComplete: true };
      return json(200, { user: account, starter: { portfolioItems: 0, organizationId: null } });
    }
    if (path === '/api/portfolio') return json(200, { items: links });
    if (path === '/api/notifications/unread') return json(200, { unread: 0 });
    if (path === '/api/dashboard') return json(200, { recommendedJobs: [] });
    return json(200, {});
  });
  return calls;
}
