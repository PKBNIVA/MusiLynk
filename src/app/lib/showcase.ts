import type { PortfolioItem } from './apiTypes';
import { currencySymbol, formatNumber, periodLabel } from './format';

/**
 * "One library, many views": types for portfolios, resumes, the career record and the review
 * inbox (backend/docs/api-pages-portfolios-resumes.md), plus the pure helpers the screens share —
 * rules in plain words, client-side membership for the live preview, and sync summaries.
 */

// ---- Identities ("acting as") -------------------------------------------------------------

export type IdentityType = 'user' | 'organization' | 'act';
export interface Identity {
  type: IdentityType;
  id: string;
  name: string;
  /** "user:<id>", "organization:<id>" or "act:<id>" — the X-Verse-Act-As value. */
  key: string;
}
export interface PostedAs {
  type: 'organization' | 'act';
  id: string;
  name: string;
}

/** The short word the switcher shows under each identity. */
export function identityKind(type: IdentityType) {
  return type === 'user' ? 'You' : type === 'organization' ? 'Studio' : 'Band';
}

/** The public page of a Page's jobs. */
export const pageJobsPath = (p: Pick<PostedAs, 'type' | 'id'>) => `/pages/${p.type}/${encodeURIComponent(p.id)}`;

// ---- Rules -----------------------------------------------------------------------------------

export type RuleField = 'roles' | 'genres' | 'instruments' | 'kinds' | 'tags';
export type RuleCondition = Partial<Record<RuleField, string[]>>;
export interface Rules {
  everything?: boolean;
  any?: RuleCondition;
  all?: RuleCondition;
  only?: RuleCondition;
  exclude?: RuleCondition;
  yearFrom?: number | null;
  yearTo?: number | null;
  sort?: string;
}

const KIND_WORDS: Record<string, string> = {
  experience: 'experience',
  credit: 'credits',
  education: 'education',
  skill: 'skills',
  gear: 'gear',
  language: 'languages',
  link: 'links',
  award: 'awards',
};

/** "A", "A or B", "A, B or C". */
export function listPhrase(values: string[], conjunction = 'or') {
  if (values.length <= 1) return values[0] || '';
  return `${values.slice(0, -1).join(', ')} ${conjunction} ${values[values.length - 1]}`;
}

function clause(field: RuleField, values: string[], conjunction: string, subject: 'work' | 'record') {
  const list = listPhrase(values, conjunction);
  switch (field) {
    case 'roles':
      return `you're ${list}`;
    case 'genres':
      return `in ${list}`;
    case 'instruments':
      return `on ${list}`;
    case 'kinds':
      return subject === 'record'
        ? listPhrase(
            values.map((v) => KIND_WORDS[v] || v),
            conjunction,
          )
        : `of type ${list}`;
    default:
      return `tagged ${list}`;
  }
}

const FIELD_ORDER: RuleField[] = ['roles', 'genres', 'instruments', 'kinds', 'tags'];
const entries = (condition: RuleCondition | undefined) =>
  FIELD_ORDER.filter((f) => (condition?.[f] || []).length > 0).map((f) => [f, condition![f]!] as const);

/**
 * The rules as one plain sentence, e.g. "Includes work where you're Guitarist, or in Jazz or
 * Blues, except anything tagged cover". `subject` switches the nouns for resumes.
 */
export function describeRules(rules: Rules | null | undefined, subject: 'work' | 'record' = 'work') {
  const r = rules || {};
  const noun = subject === 'work' ? 'work' : 'career record';
  const any = entries(r.any);
  const all = entries(r.all);
  const only = entries(r.only);
  let text: string;
  if (r.everything) {
    text = `Includes all your ${noun}`;
    if (only.length) text += ` ${only.map(([f, v]) => clause(f, v, 'or', subject)).join(', ')}`;
  } else if (any.length || all.length) {
    const parts = [
      ...any.map(([f, v]) => clause(f, v, 'or', subject)),
      ...all.map(([f, v]) => clause(f, v, 'and', subject)),
    ];
    if (subject === 'record' && any.length === 1 && any[0][0] === 'kinds' && !all.length)
      text = `Includes your ${parts[0]}`;
    else
      text = `Includes ${subject === 'work' ? 'work' : 'entries'} where ${parts.join(any.length > 1 ? ', or ' : ', ')}`;
    if (only.length) text += `, only ${only.map(([f, v]) => clause(f, v, 'or', subject)).join(', ')}`;
  } else {
    return 'Only the items you pin';
  }
  const exclude = entries(r.exclude);
  if (exclude.length)
    text += `, except anything ${exclude.map(([f, v]) => clause(f, v, 'or', subject).replace(/^you're /, 'where you’re ')).join(' or ')}`;
  if (r.yearFrom && r.yearTo) text += `, from ${r.yearFrom} to ${r.yearTo}`;
  else if (r.yearFrom) text += `, from ${r.yearFrom} on`;
  else if (r.yearTo) text += `, up to ${r.yearTo}`;
  return text;
}

const lower = (values: string[] | undefined) => (values || []).map((v) => v.trim().toLowerCase()).filter(Boolean);

function facetsOf(item: PortfolioItem): Record<RuleField, string[]> {
  return {
    roles: lower(item.roles),
    genres: lower(item.genres),
    instruments: lower(item.instruments),
    tags: lower(item.tags),
    kinds: lower([item.kind || item.type].filter(Boolean)),
  };
}

function hits(condition: RuleCondition | undefined, facets: Record<RuleField, string[]>) {
  return entries(condition).some(([f, values]) => lower(values).some((v) => facets[f].includes(v)));
}

/** Mirrors ShowcaseRules#match? on the backend, for the editor's live preview. */
export function matchesRules(item: PortfolioItem, rules: Rules | null | undefined) {
  const r = rules || {};
  const year = item.year && item.year > 0 ? item.year : item.createdAt ? new Date(item.createdAt).getFullYear() : null;
  if (r.yearFrom || r.yearTo) {
    if (!year) return false;
    if (r.yearFrom && year < r.yearFrom) return false;
    if (r.yearTo && year > r.yearTo) return false;
  }
  const facets = facetsOf(item);
  if (hits(r.exclude, facets)) return false;
  const onlyHolds = entries(r.only).every(([f, values]) => {
    const stated = facets[f];
    return stated.length === 0 || lower(values).some((v) => stated.includes(v));
  });
  if (!onlyHolds) return false;
  if (r.everything) return true;
  const any = entries(r.any);
  const all = entries(r.all);
  if (!any.length && !all.length) return false;
  return (
    (!any.length || hits(r.any, facets)) &&
    all.every(([f, values]) => lower(values).every((v) => facets[f].includes(v)))
  );
}

export type MemberSource = 'rule' | 'pinned';
export interface PortfolioMember {
  itemId: string;
  source: MemberSource;
  item: PortfolioItem;
}

/** Library items that belong: pinned, or matching the rules, never excluded. Library order. */
export function computeMembers(
  library: PortfolioItem[],
  rules: Rules | null | undefined,
  pinned: string[] = [],
  excluded: string[] = [],
): PortfolioMember[] {
  return library.flatMap((item): PortfolioMember[] => {
    if (excluded.includes(item.id)) return [];
    if (pinned.includes(item.id)) return [{ itemId: item.id, source: 'pinned' as const, item }];
    return matchesRules(item, rules) ? [{ itemId: item.id, source: 'rule' as const, item }] : [];
  });
}

export type ItemState = 'pinned' | 'excluded' | 'rule' | 'out';
/** How one library item stands in a view: pinned, excluded, in by rule, or not included. */
export function itemState(
  itemId: string,
  view: { pinned?: string[]; excluded?: string[] },
  inByRule: boolean,
): ItemState {
  if ((view.excluded || []).includes(itemId)) return 'excluded';
  if ((view.pinned || []).includes(itemId)) return 'pinned';
  return inByRule ? 'rule' : 'out';
}

/** Rules with empty lists and empty conditions removed, so the stored JSON stays tidy. */
export function cleanRules(rules: Rules): Rules {
  const out: Rules = {};
  if (rules.everything) out.everything = true;
  for (const name of ['any', 'all', 'only', 'exclude'] as const) {
    const kept = entries(rules[name]);
    if (kept.length) out[name] = Object.fromEntries(kept.map(([f, v]) => [f, [...v]]));
  }
  if (rules.yearFrom) out.yearFrom = rules.yearFrom;
  if (rules.yearTo) out.yearTo = rules.yearTo;
  if (rules.sort) out.sort = rules.sort;
  return out;
}

/**
 * Switches between "everything, limited by" (`only`) and "only work that matches" (`any`),
 * moving the chosen values across so nothing typed is lost.
 */
export function setRulesMode(rules: Rules, everything: boolean): Rules {
  const from = everything ? 'any' : 'only';
  const to = everything ? 'only' : 'any';
  const moved: RuleCondition = { ...(rules[to] || {}) };
  for (const [f, v] of entries(rules[from])) moved[f] = Array.from(new Set([...(moved[f] || []), ...v]));
  return cleanRules({ ...rules, everything, [from]: undefined, [to]: moved });
}

/** Sets one field of one condition (e.g. any.genres) and tidies the result. */
export function setRuleValues(
  rules: Rules,
  condition: 'any' | 'all' | 'only' | 'exclude',
  field: RuleField,
  values: string[],
) {
  return cleanRules({ ...rules, [condition]: { ...(rules[condition] || {}), [field]: values } });
}

// ---- Portfolios ------------------------------------------------------------------------------

export type Visibility = 'public' | 'link' | 'private';
export interface Rates {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  basis?: string | null;
}
export const INHERITED_FIELDS = ['headline', 'bio', 'city', 'genres', 'rates'] as const;
export type InheritedField = (typeof INHERITED_FIELDS)[number];
export interface MasterCopy {
  headline?: string | null;
  bio?: string | null;
  city?: string | null;
  genres?: string[] | null;
  rates?: Rates | null;
}
export interface Portfolio extends MasterCopy {
  id: string;
  ownerType: IdentityType;
  ownerId: string;
  ownerName?: string | null;
  title: string;
  purpose?: string | null;
  overridden?: InheritedField[];
  master?: MasterCopy;
  rules?: Rules;
  pinnedItemIds?: string[];
  excludedItemIds?: string[];
  itemOrder?: string[];
  visibility: Visibility;
  slug: string;
  isDefault?: boolean;
  status?: 'active' | 'hidden';
  itemCount?: number;
  itemIds?: string[];
  items?: PortfolioMember[];
  createdAt?: string;
  updatedAt?: string;
}
export interface PortfolioDraft {
  title?: string | null;
  purpose?: string | null;
  rules: Rules;
  pinnedItemIds: string[];
  excludedItemIds: string[];
  terms?: Partial<Record<RuleField, string[]>>;
  items: { itemId: string; title: string; included: boolean; reason: string }[];
  summary?: { total: number; kept: number; removed: number };
  note?: string | null;
}

export const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', description: 'Anyone can find and open it' },
  { value: 'link', label: 'Anyone with the link', description: 'Not listed; share the link yourself' },
  { value: 'private', label: 'Private', description: 'Only you, and hirers you apply to' },
];

/** The public (EPK) address of a portfolio. */
export function publicPortfolioUrl(slug: string, origin = typeof window === 'undefined' ? '' : window.location.origin) {
  return `${origin}/p/${encodeURIComponent(slug)}`;
}

const RATE_BASIS: Record<string, string> = {
  hour: 'hour',
  session: 'session',
  day: 'day',
  show: 'show',
  event: 'event',
  project: 'project',
  track: 'track',
  song: 'song',
};
export const RATE_BASES = Object.keys(RATE_BASIS);

/** "₹5,000–8,000 per session", "From ₹5,000 per show", or "" when no amount is set. */
export function formatRates(rates: Rates | null | undefined) {
  if (!rates || (rates.min == null && rates.max == null)) return '';
  const code = currencySymbol(rates.currency);
  const symbol = /^[A-Za-z]/.test(code) ? `${code} ` : code;
  const n = (v: number) => formatNumber(v);
  const per = rates.basis ? ` per ${RATE_BASIS[rates.basis] || periodLabel(rates.basis)}` : '';
  if (rates.min != null && rates.max != null && rates.max !== rates.min)
    return `${symbol}${n(rates.min)}–${n(rates.max)}${per}`;
  if (rates.min != null) return `${rates.max == null ? 'From ' : ''}${symbol}${n(rates.min)}${per}`;
  return `Up to ${symbol}${n(rates.max!)}${per}`;
}

/** Whether a field shows its own value (true) or the one from the profile. */
export const isOverridden = (view: { overridden?: string[] }, field: string) => (view.overridden || []).includes(field);

/** Pins and exclusions to save from a draft the person has trimmed. */
export function draftSelection(draft: PortfolioDraft, kept: Record<string, boolean>) {
  const pinnedItemIds: string[] = [];
  const excludedItemIds: string[] = [];
  for (const item of draft.items) {
    const keep = kept[item.itemId] ?? item.included;
    if (keep && !item.included) pinnedItemIds.push(item.itemId);
    if (!keep && item.included) excludedItemIds.push(item.itemId);
  }
  return { pinnedItemIds, excludedItemIds };
}

/**
 * Reads the draft_portfolio AI reply ({"title","blurb","itemIds"}), keeping only ids that were
 * offered. Returns null for anything that is not that shape.
 */
export function parseAiDraft(text: string, offered: string[]) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const data = JSON.parse(json) as { title?: unknown; blurb?: unknown; itemIds?: unknown };
    if (!Array.isArray(data.itemIds)) return null;
    return {
      title: typeof data.title === 'string' ? data.title : '',
      blurb: typeof data.blurb === 'string' ? data.blurb : '',
      itemIds: data.itemIds.filter((id): id is string => typeof id === 'string' && offered.includes(id)),
    };
  } catch {
    return null;
  }
}

// ---- Suggestions -----------------------------------------------------------------------------

export interface Suggestion {
  id: string;
  kind: 'include' | 'tags';
  status: 'pending' | 'accepted' | 'rejected' | 'obsolete';
  reason: string;
  payload?: Partial<Record<'tags' | 'roles' | 'genres' | 'instruments', string[]>>;
  target: { type: 'portfolio' | 'resume' | 'portfolio_item'; id: string; title: string };
  subject: { type: 'portfolio_item' | 'career_entry'; id: string; title: string };
  createdAt?: string;
  resolvedAt?: string | null;
}

/** What a suggestion asks, as a short question. */
export function suggestionQuestion(s: Suggestion) {
  if (s.kind === 'tags') {
    const values = Object.values(s.payload || {}).flat();
    return `Tag “${s.subject.title}” with ${listPhrase(values, 'and')}?`;
  }
  return `Add “${s.subject.title}” to “${s.target.title}”?`;
}

/** "Added to 2 portfolios · 1 suggestion to review" after a work sample is saved. */
export function syncSummary(itemId: string, portfolios: Pick<Portfolio, 'itemIds'>[], suggestions: Suggestion[]) {
  const joined = portfolios.filter((p) => (p.itemIds || []).includes(itemId)).length;
  const pending = suggestions.filter((s) => s.status === 'pending' && s.subject.id === itemId).length;
  const parts = [joined ? `Added to ${joined} portfolio${joined === 1 ? '' : 's'}` : 'Not in any portfolio yet'];
  if (pending) parts.push(`${pending} suggestion${pending === 1 ? '' : 's'} to review`);
  return { joined, pending, text: parts.join(' · ') };
}

// ---- Career record and resumes ----------------------------------------------------------------

export type CareerKind = 'experience' | 'credit' | 'education' | 'skill' | 'gear' | 'language' | 'link' | 'award';
export interface CareerEntry {
  id: string;
  kind: CareerKind;
  fields: Record<string, string | number | boolean | null | undefined>;
  startOn?: string | null;
  endOn?: string | null;
  tags?: string[];
  position?: number;
  source?: MemberSource;
}
type FieldSpec = {
  name: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'textarea' | 'url' | 'year' | 'bool' | 'select';
  options?: string[];
};

/** Each kind's fields, in form order (CareerEntry::KINDS on the backend). */
export const CAREER_KINDS: { kind: CareerKind; label: string; dated?: boolean; fields: FieldSpec[] }[] = [
  {
    kind: 'experience',
    label: 'Experience',
    dated: true,
    fields: [
      { name: 'role', label: 'Role', required: true },
      { name: 'organization', label: 'Band, studio or company' },
      { name: 'location', label: 'Location' },
      { name: 'current', label: 'I still do this', type: 'bool' },
      { name: 'description', label: 'What you did', type: 'textarea' },
    ],
  },
  {
    kind: 'credit',
    label: 'Credits',
    fields: [
      { name: 'title', label: 'Release or project', required: true },
      { name: 'role', label: 'Your role' },
      { name: 'artist', label: 'Artist' },
      { name: 'year', label: 'Year', type: 'year' },
      { name: 'url', label: 'Link', type: 'url' },
    ],
  },
  {
    kind: 'education',
    label: 'Education',
    dated: true,
    fields: [
      { name: 'institution', label: 'School or teacher', required: true },
      { name: 'qualification', label: 'Qualification' },
      { name: 'field', label: 'Subject' },
    ],
  },
  {
    kind: 'skill',
    label: 'Skills',
    fields: [
      { name: 'name', label: 'Skill', required: true },
      { name: 'level', label: 'Level', type: 'select', options: ['beginner', 'intermediate', 'advanced', 'expert'] },
    ],
  },
  {
    kind: 'gear',
    label: 'Gear',
    fields: [
      { name: 'name', label: 'Item', required: true },
      { name: 'notes', label: 'Notes' },
    ],
  },
  {
    kind: 'language',
    label: 'Languages',
    fields: [
      { name: 'name', label: 'Language', required: true },
      {
        name: 'proficiency',
        label: 'Proficiency',
        type: 'select',
        options: ['basic', 'conversational', 'fluent', 'native'],
      },
    ],
  },
  {
    kind: 'link',
    label: 'Links',
    fields: [
      { name: 'label', label: 'Label' },
      { name: 'url', label: 'Link', type: 'url', required: true },
    ],
  },
  {
    kind: 'award',
    label: 'Awards',
    fields: [
      { name: 'title', label: 'Award', required: true },
      { name: 'issuer', label: 'Given by' },
      { name: 'year', label: 'Year', type: 'year' },
      { name: 'url', label: 'Link', type: 'url' },
    ],
  },
];
export const kindLabel = (kind: string) => CAREER_KINDS.find((k) => k.kind === kind)?.label || kind;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const text = (v: unknown) => (v === null || v === undefined || v === false ? '' : String(v));
const yearOf = (date?: string | null) => (date ? date.slice(0, 4) : '');

/** The one-line headline of an entry: its required field. */
export function entryTitle(entry: CareerEntry) {
  const spec = CAREER_KINDS.find((k) => k.kind === entry.kind);
  const main = spec?.fields.find((f) => f.required)?.name || 'title';
  if (entry.kind === 'link') return text(entry.fields.label) || text(entry.fields.url) || kindLabel(entry.kind);
  return text(entry.fields[main]) || kindLabel(entry.kind);
}

/** The supporting line: organisation, artist, level, dates… */
export function entryDetail(entry: CareerEntry) {
  const f = entry.fields;
  const parts: string[] = [];
  switch (entry.kind) {
    case 'experience':
      parts.push(text(f.organization), text(f.location));
      break;
    case 'credit':
      parts.push(text(f.role), text(f.artist), text(f.year));
      break;
    case 'education':
      parts.push(text(f.qualification), text(f.field));
      break;
    case 'skill':
      parts.push(capital(text(f.level)));
      break;
    case 'gear':
      parts.push(text(f.notes));
      break;
    case 'language':
      parts.push(capital(text(f.proficiency)));
      break;
    case 'link':
      parts.push(entry.fields.label ? text(f.url).replace(/^https:\/\//, '') : '');
      break;
    case 'award':
      parts.push(text(f.issuer), text(f.year));
      break;
  }
  const from = yearOf(entry.startOn);
  const to = f.current ? 'now' : yearOf(entry.endOn);
  if (from || to) parts.push(from && to && from !== to ? `${from}–${to}` : from || to);
  return parts.filter(Boolean).join(' · ');
}

export interface Resume {
  id: string;
  title: string;
  targetRole?: string | null;
  headline?: string | null;
  summary?: string | null;
  overridden?: ('headline' | 'summary')[];
  master?: { headline?: string | null; summary?: string | null };
  rules?: Rules;
  pinnedEntryIds?: string[];
  excludedEntryIds?: string[];
  entryOrder?: string[];
  sectionOrder?: CareerKind[];
  pdf?: { id: string; url: string; filename: string; byteSize?: number } | null;
  isDefault?: boolean;
  entryCount?: number;
  sections?: { kind: CareerKind; entries: CareerEntry[] }[];
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_SECTION_ORDER: CareerKind[] = [
  'experience',
  'credit',
  'award',
  'education',
  'skill',
  'gear',
  'language',
  'link',
];

/** The full section order: the chosen order first, then the rest in the default order. */
export function fullSectionOrder(order: CareerKind[] | undefined) {
  const chosen = (order || []).filter((k) => DEFAULT_SECTION_ORDER.includes(k));
  return [...new Set([...chosen, ...DEFAULT_SECTION_ORDER])];
}

/** Moves one entry of a list up (-1) or down (+1); out-of-range moves return the list unchanged. */
export function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Mirrors ShowcaseRules for career entries (kinds and tags only). */
export function entryMatches(entry: CareerEntry, rules: Rules | null | undefined) {
  return matchesRules(
    {
      id: entry.id,
      kind: entry.kind,
      type: entry.kind,
      title: '',
      url: '',
      tags: entry.tags,
      year: (entry.startOn ? Number(entry.startOn.slice(0, 4)) : null) || Number(entry.fields.year) || null,
      createdAt: undefined,
    },
    rules,
  );
}

/** Fired on window after anything that can change the "Review changes" count. */
export const SUGGESTIONS_CHANGED_EVENT = 'musilynk:suggestions-changed';
export function announceSuggestionsChanged() {
  window.dispatchEvent(new Event(SUGGESTIONS_CHANGED_EVENT));
}
