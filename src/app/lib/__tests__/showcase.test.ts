import { describe, expect, it, vi } from 'vitest';
import {
  announceSuggestionsChanged,
  cleanRules,
  computeMembers,
  describeRules,
  draftSelection,
  entryDetail,
  entryMatches,
  entryTitle,
  formatRates,
  fullSectionOrder,
  identityKind,
  isOverridden,
  itemState,
  kindLabel,
  listPhrase,
  matchesRules,
  move,
  pageJobsPath,
  parseAiDraft,
  publicPortfolioUrl,
  setRulesMode,
  setRuleValues,
  suggestionQuestion,
  SUGGESTIONS_CHANGED_EVENT,
  syncSummary,
  type CareerEntry,
  type PortfolioDraft,
  type Suggestion,
} from '../showcase';
import type { PortfolioItem } from '../apiTypes';

const item = (over: Partial<PortfolioItem>): PortfolioItem => ({
  id: 'i',
  kind: 'audio',
  type: 'audio',
  title: 'Track',
  url: 'https://x',
  ...over,
});
const jazz = item({ id: 'jazz', genres: ['Jazz'], roles: ['Guitarist'], year: 2020, tags: ['live'] });
const rock = item({ id: 'rock', genres: ['Rock'], roles: ['Guitarist'], year: 2016, tags: ['cover'] });
const bare = item({ id: 'bare', createdAt: '2023-05-01T00:00:00Z' });

describe('describeRules', () => {
  it('reads any/all rules as a sentence', () => {
    expect(describeRules({ any: { roles: ['Guitarist'], genres: ['Jazz', 'Blues'] } })).toBe(
      "Includes work where you're Guitarist, or in Jazz or Blues",
    );
    expect(describeRules({ any: { instruments: ['Tabla'] }, all: { tags: ['live', 'original'] } })).toBe(
      'Includes work where on Tabla, tagged live and original',
    );
    expect(describeRules({ any: { kinds: ['video'] } })).toBe('Includes work where of type video');
  });

  it('covers everything, only, exclusions and years', () => {
    expect(describeRules({ everything: true })).toBe('Includes all your work');
    expect(describeRules({ everything: true, only: { genres: ['Jazz'] }, yearFrom: 2018, yearTo: 2025 })).toBe(
      'Includes all your work in Jazz, from 2018 to 2025',
    );
    expect(describeRules({ any: { tags: ['live'] }, only: { genres: ['Jazz'] }, yearFrom: 2018 })).toBe(
      'Includes work where tagged live, only in Jazz, from 2018 on',
    );
    expect(describeRules({ everything: true, exclude: { tags: ['cover'], roles: ['Singer'] }, yearTo: 2020 })).toBe(
      'Includes all your work, except anything where you’re Singer or tagged cover, up to 2020',
    );
    expect(describeRules({})).toBe('Only the items you pin');
    expect(describeRules(null)).toBe('Only the items you pin');
  });

  it('uses career-record nouns for resumes', () => {
    expect(describeRules({ everything: true }, 'record')).toBe('Includes all your career record');
    expect(describeRules({ any: { kinds: ['experience', 'credit'] } }, 'record')).toBe(
      'Includes your experience or credits',
    );
    expect(describeRules({ any: { kinds: ['odd'], tags: ['film'] } }, 'record')).toBe(
      'Includes entries where odd, or tagged film',
    );
  });

  it('joins lists naturally', () => {
    expect(listPhrase([])).toBe('');
    expect(listPhrase(['A'])).toBe('A');
    expect(listPhrase(['A', 'B', 'C'], 'and')).toBe('A, B and C');
  });
});

describe('matching', () => {
  it('mirrors the server rules', () => {
    expect(matchesRules(jazz, { any: { genres: ['jazz'] } })).toBe(true);
    expect(matchesRules(rock, { any: { genres: ['jazz'] } })).toBe(false);
    expect(matchesRules(jazz, { everything: true, exclude: { tags: ['LIVE'] } })).toBe(false);
    expect(matchesRules(bare, { everything: true, only: { genres: ['Jazz'] } })).toBe(true);
    expect(matchesRules(rock, { everything: true, only: { genres: ['Jazz'] } })).toBe(false);
    expect(matchesRules(jazz, { all: { tags: ['live'] }, any: { roles: ['guitarist'] } })).toBe(true);
    expect(matchesRules(jazz, { all: { tags: ['live', 'original'] } })).toBe(false);
    expect(matchesRules(jazz, {})).toBe(false);
    expect(matchesRules(jazz, null)).toBe(false);
    expect(matchesRules(item({ kind: '', type: 'video' }), { any: { kinds: ['video'] } })).toBe(true);
  });

  it('filters by year, using the created date when no year is set', () => {
    expect(matchesRules(jazz, { everything: true, yearFrom: 2018 })).toBe(true);
    expect(matchesRules(rock, { everything: true, yearFrom: 2018 })).toBe(false);
    expect(matchesRules(jazz, { everything: true, yearTo: 2019 })).toBe(false);
    expect(matchesRules(bare, { everything: true, yearFrom: 2023, yearTo: 2023 })).toBe(true);
    expect(matchesRules(item({ id: 'x' }), { everything: true, yearFrom: 2000 })).toBe(false);
  });

  it('computes members with pins and exclusions', () => {
    const members = computeMembers([jazz, rock, bare], { any: { genres: ['Jazz'] } }, ['bare', 'rock'], ['rock']);
    expect(members.map((m) => [m.itemId, m.source])).toEqual([
      ['jazz', 'rule'],
      ['bare', 'pinned'],
    ]);
    expect(computeMembers([jazz], { everything: true })).toHaveLength(1);
  });

  it('names each item state', () => {
    expect(itemState('a', { pinned: ['a'], excluded: [] }, false)).toBe('pinned');
    expect(itemState('a', { pinned: ['a'], excluded: ['a'] }, true)).toBe('excluded');
    expect(itemState('a', {}, true)).toBe('rule');
    expect(itemState('a', {}, false)).toBe('out');
  });
});

describe('editing rules', () => {
  it('tidies empty lists away', () => {
    expect(
      cleanRules({
        everything: false,
        any: { genres: [] },
        exclude: { tags: ['x'] },
        yearFrom: 2000,
        yearTo: 2001,
        sort: 'newest',
      }),
    ).toEqual({ exclude: { tags: ['x'] }, yearFrom: 2000, yearTo: 2001, sort: 'newest' });
  });

  it('moves values between modes without losing them', () => {
    const matching = { any: { genres: ['Jazz'] }, only: { genres: ['Blues'] } };
    expect(setRulesMode(matching, true)).toEqual({ everything: true, only: { genres: ['Blues', 'Jazz'] } });
    expect(setRulesMode({ everything: true, only: { roles: ['Singer'] } }, false)).toEqual({
      any: { roles: ['Singer'] },
    });
  });

  it('sets one field of one condition', () => {
    expect(setRuleValues({ any: { roles: ['A'] } }, 'any', 'genres', ['Jazz'])).toEqual({
      any: { roles: ['A'], genres: ['Jazz'] },
    });
    expect(setRuleValues({ exclude: { tags: ['x'] } }, 'exclude', 'tags', [])).toEqual({});
  });
});

describe('portfolio helpers', () => {
  it('formats rates', () => {
    expect(formatRates(null)).toBe('');
    expect(formatRates({})).toBe('');
    expect(formatRates({ min: 5000, max: 8000, basis: 'session' })).toBe('₹5,000–8,000 per session');
    expect(formatRates({ min: 5000, max: 5000, currency: 'INR', basis: 'show' })).toBe('₹5,000 per show');
    expect(formatRates({ min: 5000, currency: 'USD', basis: 'gig' })).toBe('From $5,000 per gig');
    expect(formatRates({ max: 900 })).toBe('Up to ₹900');
  });

  it('builds links and labels', () => {
    expect(publicPortfolioUrl('jazz sessions-x', 'https://verse.test')).toBe('https://verse.test/p/jazz%20sessions-x');
    expect(publicPortfolioUrl('a')).toBe(`${window.location.origin}/p/a`);
    expect(pageJobsPath({ type: 'act', id: 'a/1' })).toBe('/pages/act/a%2F1');
    expect(identityKind('user')).toBe('You');
    expect(identityKind('organization')).toBe('Studio');
    expect(identityKind('act')).toBe('Band');
    expect(isOverridden({ overridden: ['bio'] }, 'bio')).toBe(true);
    expect(isOverridden({}, 'bio')).toBe(false);
  });

  it('turns a trimmed draft into pins and exclusions', () => {
    const draft = {
      rules: {},
      pinnedItemIds: [],
      excludedItemIds: [],
      items: [
        { itemId: 'a', title: 'A', included: true, reason: '' },
        { itemId: 'b', title: 'B', included: false, reason: '' },
        { itemId: 'c', title: 'C', included: true, reason: '' },
      ],
    } as PortfolioDraft;
    expect(draftSelection(draft, { a: false, b: true })).toEqual({ pinnedItemIds: ['b'], excludedItemIds: ['a'] });
    expect(draftSelection(draft, {})).toEqual({ pinnedItemIds: [], excludedItemIds: [] });
  });

  it('reads the AI draft reply, keeping only offered ids', () => {
    expect(parseAiDraft('Sure! {"title":"Reel","blurb":"Hi","itemIds":["a","zz",3]} done', ['a', 'b'])).toEqual({
      title: 'Reel',
      blurb: 'Hi',
      itemIds: ['a'],
    });
    expect(parseAiDraft('{"itemIds":["b"]}', ['b'])).toEqual({ title: '', blurb: '', itemIds: ['b'] });
    expect(parseAiDraft('{"title":"x"}', ['a'])).toBeNull();
    expect(parseAiDraft('not json', ['a'])).toBeNull();
  });
});

describe('suggestions', () => {
  const include: Suggestion = {
    id: 's1',
    kind: 'include',
    status: 'pending',
    reason: 'mentions jazz',
    target: { type: 'portfolio', id: 'p1', title: 'Jazz' },
    subject: { type: 'portfolio_item', id: 'i1', title: 'Late set' },
  };
  const tags: Suggestion = {
    ...include,
    id: 's2',
    kind: 'tags',
    payload: { genres: ['Jazz'], tags: ['live'] },
    target: { type: 'portfolio_item', id: 'i1', title: 'Late set' },
  };

  it('asks a short question', () => {
    expect(suggestionQuestion(include)).toBe('Add “Late set” to “Jazz”?');
    expect(suggestionQuestion(tags)).toBe('Tag “Late set” with Jazz and live?');
    expect(suggestionQuestion({ ...tags, payload: undefined })).toBe('Tag “Late set” with ?');
  });

  it('summarises where a saved item landed', () => {
    const portfolios = [{ itemIds: ['i1'] }, { itemIds: ['i1', 'x'] }, { itemIds: [] }, {}];
    expect(syncSummary('i1', portfolios, [include, { ...include, id: 's3', status: 'rejected' }])).toEqual({
      joined: 2,
      pending: 1,
      text: 'Added to 2 portfolios · 1 suggestion to review',
    });
    expect(syncSummary('i1', [{ itemIds: ['i1'] }], [include, tags]).text).toBe(
      'Added to 1 portfolio · 2 suggestions to review',
    );
    expect(syncSummary('zz', portfolios, []).text).toBe('Not in any portfolio yet');
  });

  it('announces changes', () => {
    const listener = vi.fn();
    window.addEventListener(SUGGESTIONS_CHANGED_EVENT, listener);
    announceSuggestionsChanged();
    window.removeEventListener(SUGGESTIONS_CHANGED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('career record', () => {
  const entry = (
    kind: CareerEntry['kind'],
    fields: CareerEntry['fields'],
    over: Partial<CareerEntry> = {},
  ): CareerEntry => ({
    id: kind,
    kind,
    fields,
    ...over,
  });

  it('titles and details every kind', () => {
    const cases: [CareerEntry, string, string][] = [
      [
        entry(
          'experience',
          { role: 'Keys', organization: 'Band', location: 'Pune', current: true },
          { startOn: '2021-01-01' },
        ),
        'Keys',
        'Band · Pune · 2021–now',
      ],
      [entry('credit', { title: 'Album', role: 'Keys', artist: 'X', year: 2022 }), 'Album', 'Keys · X · 2022'],
      [
        entry(
          'education',
          { institution: 'KM', qualification: 'Diploma', field: 'Sound' },
          { startOn: '2019-06-01', endOn: '2019-12-01' },
        ),
        'KM',
        'Diploma · Sound · 2019',
      ],
      [entry('skill', { name: 'Ableton', level: 'expert' }), 'Ableton', 'Expert'],
      [entry('gear', { name: 'Nord', notes: 'Stage 4' }), 'Nord', 'Stage 4'],
      [entry('language', { name: 'Hindi', proficiency: 'native' }), 'Hindi', 'Native'],
      [entry('link', { label: 'Site', url: 'https://riya.in' }), 'Site', 'riya.in'],
      [entry('link', { url: 'https://riya.in' }), 'https://riya.in', ''],
      [
        entry('award', { title: 'Best', issuer: 'Jury', year: 2024 }, { endOn: '2024-01-01' }),
        'Best',
        'Jury · 2024 · 2024',
      ],
    ];
    for (const [e, title, detail] of cases) {
      expect(entryTitle(e)).toBe(title);
      expect(entryDetail(e)).toBe(detail);
    }
    expect(entryTitle(entry('skill', {}))).toBe('Skills');
    expect(entryTitle({ id: 'x', kind: 'mystery' as CareerEntry['kind'], fields: {} })).toBe('mystery');
    expect(entryDetail({ id: 'x', kind: 'mystery' as CareerEntry['kind'], fields: {} })).toBe('');
    expect(kindLabel('credit')).toBe('Credits');
  });

  it('orders sections and moves entries', () => {
    expect(fullSectionOrder(['link', 'bogus' as 'link'])[0]).toBe('link');
    expect(fullSectionOrder(undefined)).toHaveLength(8);
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(move(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
  });

  it('matches entries by kind, tag and year', () => {
    const credit = entry('credit', { title: 'A', year: 2015 }, { tags: ['film'] });
    const job = entry('experience', { role: 'B' }, { startOn: '2022-01-01' });
    expect(entryMatches(credit, { any: { kinds: ['credit'] } })).toBe(true);
    expect(entryMatches(credit, { everything: true, yearFrom: 2018 })).toBe(false);
    expect(entryMatches(job, { everything: true, yearFrom: 2018 })).toBe(true);
    expect(entryMatches(entry('skill', { name: 'x' }), { everything: true, yearFrom: 2018 })).toBe(false);
    expect(entryMatches(credit, { everything: true, exclude: { tags: ['film'] } })).toBe(false);
  });
});
