import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ apiPost: vi.fn(), apiGet: vi.fn() }));
import { apiGet, apiPost } from '../api';
import {
  MAX_LINKS,
  compactStarter,
  detectProvider,
  fetchLinkPreview,
  hasStarter,
  localPreview,
  normalizeLink,
  previewTitle,
  starterLinks,
  type LinkPreview,
} from '../onboarding';
import { HIRE_ROLES, PROOF_THRESHOLDS, hireLinkText, hireSearchPath, loadPublicStats, proofItems } from '../landing';
import { buildBio, buildHeadline, cityName, listPhrase, yearsOf } from '../profileTemplates';

afterEach(() => vi.mocked(apiPost).mockReset());

describe('normalizeLink', () => {
  it('adds https to bare and http links and keeps https ones', () => {
    expect(normalizeLink(' youtube.com/watch?v=1 ')).toBe('https://youtube.com/watch?v=1');
    expect(normalizeLink('//soundcloud.com/a')).toBe('https://soundcloud.com/a');
    expect(normalizeLink('http://open.spotify.com/track/1')).toBe('https://open.spotify.com/track/1');
    expect(normalizeLink('HTTPS://www.instagram.com/reel/x')).toBe('https://www.instagram.com/reel/x');
  });
  it('refuses empty, non-web and credentialled links', () => {
    for (const bad of [
      '',
      '   ',
      'javascript:void(0)',
      'ftp://x.com/a',
      'localhost',
      'https://u:p@x.com',
      'https://exa mple.com',
    ])
      expect(normalizeLink(bad), bad).toBeNull();
  });
});

describe('providers and previews', () => {
  it('detects the service from the host', () => {
    expect(detectProvider('https://youtu.be/1')).toBe('youtube');
    expect(detectProvider('https://m.soundcloud.com/1')).toBe('soundcloud');
    expect(detectProvider('https://instagram.com/p/1')).toBe('instagram');
    expect(detectProvider('https://spotify.link/1')).toBe('spotify');
    expect(detectProvider('https://bandcamp.com/1')).toBe('link');
    expect(detectProvider('not a url')).toBe('link');
  });
  it('builds a local preview with the right kind', () => {
    expect(localPreview('https://youtu.be/1')).toMatchObject({ provider: 'youtube', kind: 'video', label: 'YouTube' });
    expect(localPreview('https://open.spotify.com/1')).toMatchObject({ kind: 'audio' });
    expect(localPreview('https://myband.in/epk')).toMatchObject({ provider: 'link', kind: 'link', title: null });
  });
  it('titles a preview from its title, its service or its host', () => {
    const base = localPreview('https://www.myband.in/epk');
    expect(previewTitle({ ...base, title: 'Set' })).toBe('Set');
    expect(previewTitle(base)).toBe('myband.in');
    expect(previewTitle(localPreview('https://open.spotify.com/1'))).toBe('Spotify link');
    expect(previewTitle(localPreview('https://open.spotify.com/track/1'))).toBe('Spotify track');
    expect(previewTitle(localPreview('https://open.spotify.com/artist/1'))).toBe('Spotify artist');
    expect(previewTitle(localPreview('https://open.spotify.com/intl-in/album/1'))).toBe('Spotify album');
    expect(previewTitle(localPreview('https://youtu.be/1'))).toBe('YouTube post');
    expect(previewTitle({ ...base, url: 'nonsense' })).toBe('nonsense');
  });
  it('asks the API for a preview without the sign-in redirect', () => {
    vi.mocked(apiPost).mockResolvedValue({});
    void fetchLinkPreview('https://youtu.be/1');
    expect(apiPost).toHaveBeenCalledWith(
      '/link-previews',
      { url: 'https://youtu.be/1' },
      { skipAuthRedirect: true, timeoutMs: 8_000 },
    );
  });
});

describe('starter payload', () => {
  it('drops empty answers and caps links', () => {
    const links = Array.from({ length: MAX_LINKS + 2 }, (_, i) => ({ url: `https://x.com/${i}` }));
    expect(
      compactStarter({
        roles: ['Drummer'],
        city: ' Mumbai ',
        yearsExperience: 0,
        headline: ' H ',
        bio: ' B ',
        links,
        hirerKind: 'studio',
        companyName: ' Tape Room ',
      }),
    ).toEqual({
      roles: ['Drummer'],
      city: 'Mumbai',
      yearsExperience: 0,
      headline: 'H',
      bio: 'B',
      links: links.slice(0, MAX_LINKS),
      hirerKind: 'studio',
      companyName: 'Tape Room',
    });
    expect(compactStarter({ roles: [], city: ' ', headline: '', bio: '', links: [], companyName: '' })).toEqual({});
    expect(hasStarter({ city: '' })).toBe(false);
    expect(hasStarter({ city: 'Pune' })).toBe(true);
  });
  it('sends only the preview details that were found', () => {
    const preview = (over: Partial<LinkPreview>): LinkPreview => ({ ...localPreview('https://youtu.be/1'), ...over });
    expect(starterLinks([preview({ title: 'T', thumbnail: 'https://i.ytimg.com/a.jpg' }), preview({})])).toEqual([
      { url: 'https://youtu.be/1', title: 'T', thumbnail: 'https://i.ytimg.com/a.jpg' },
      { url: 'https://youtu.be/1' },
    ]);
  });
});

describe('landing proof', () => {
  it('shows only counts at or above their thresholds', () => {
    expect(proofItems(null)).toEqual([]);
    expect(proofItems({})).toEqual([]);
    expect(proofItems({ verifiedProfiles: 9, cities: 1, openOpportunities: 2, urgentRequests: 2 })).toEqual([]);
    expect(
      proofItems({
        verifiedProfiles: PROOF_THRESHOLDS.verifiedProfiles,
        cities: 3,
        openOpportunities: 1200,
        urgentRequests: Number.NaN,
      }),
    ).toEqual([
      { key: 'verifiedProfiles', value: '10', label: 'verified musicians and crew' },
      { key: 'cities', value: '3', label: 'cities' },
      { key: 'openOpportunities', value: '1,200', label: 'open gigs and sessions' },
    ]);
  });
  it('loads stats quietly', () => {
    vi.mocked(apiGet).mockResolvedValue({});
    void loadPublicStats();
    // viaEdge: the landing counters go through the edge-cached same-origin path (docs/ops/edge-caching.md).
    expect(apiGet).toHaveBeenCalledWith('/public/stats', { skipAuthRedirect: true, timeoutMs: 6_000, viaEdge: true });
  });
  it('links each role to the directory search for the city', () => {
    expect(HIRE_ROLES.length).toBeGreaterThan(6);
    expect(hireSearchPath('keyboard player', 'Mumbai')).toBe(
      '/music-professionals?role=keyboard+player&location=Mumbai',
    );
    expect(hireLinkText('Drummer', 'Mumbai')).toBe('Hire a drummer in Mumbai');
    expect(hireLinkText('Arranger', 'Pune')).toBe('Hire an arranger in Pune');
    expect(hireLinkText('DJ', 'Mumbai')).toBe('Hire a DJ in Mumbai');
  });
});

describe('profile templates', () => {
  it('reads years and cities', () => {
    expect(yearsOf(null)).toBeNull();
    expect(yearsOf(' ')).toBeNull();
    expect(yearsOf('8')).toBe(8);
    expect(yearsOf(2.5)).toBeNull();
    expect(yearsOf(81)).toBeNull();
    expect(cityName('Mumbai, Maharashtra')).toBe('Mumbai');
    expect(cityName()).toBe('');
    expect(listPhrase([])).toBe('');
    expect(listPhrase(['a'])).toBe('a');
    expect(listPhrase(['a', 'b', 'c'])).toBe('a, b and c');
  });
  it('builds a headline from roles, city and years', () => {
    expect(buildHeadline({ city: 'Mumbai', years: 3 })).toBe('');
    expect(
      buildHeadline({ roles: ['Session drummer', ' ', 'Session drummer', 'DJ'], city: 'Mumbai, MH', years: 1 }),
    ).toBe('Session drummer · DJ · Mumbai · 1 year');
    expect(buildHeadline({ roles: ['Singer'] })).toBe('Singer');
    expect(buildHeadline({ roles: ['x'.repeat(300)] })).toHaveLength(160);
  });
  it('builds a first-person bio', () => {
    expect(buildBio({ city: 'Mumbai' })).toBe('');
    expect(
      buildBio({
        roles: ['Arranger', 'Session Drummer', 'DJ'],
        city: 'Mumbai',
        years: 8,
        genres: ['Bollywood', 'indie'],
        credits: ['Single A', 'Ad B'],
      }),
    ).toBe(
      "I'm an arranger, session drummer and DJ based in Mumbai, with 8 years of experience. I mostly work in Bollywood and indie. Recent work: Single A; Ad B. Send me your dates and the brief, and I will get back to you.",
    );
    expect(buildBio({ roles: ['Singer'], years: 0 })).toBe(
      "I'm a singer. Send me your dates and the brief, and I will get back to you.",
    );
  });
});
