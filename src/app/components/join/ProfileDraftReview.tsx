import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AutocompleteInput } from '../ai/AutocompleteInput';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { ROLE_MAX_LENGTH } from '../../lib/onboarding';
import { foundInLink, sourceLabel, type DraftResult, type DraftSource, type ProfileDraft } from '../../lib/linkImport';

function thumbnailFor(url: string, sources: DraftSource[]): string | null {
  return sources.find((source) => source.url === url)?.thumbnail ?? null;
}

/** A small pill next to a field that a provenance entry traces to a specific link. */
function SourceChip({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200">
      from {label}
    </span>
  );
}

export interface DraftReviewProps {
  result: DraftResult;
  onUse: (draft: ProfileDraft) => void;
  onSkip: () => void;
  /** "Use this" button label; defaults to "Use this". */
  useLabel?: string;
}

/**
 * The review card: "We drafted this from your links. Fix anything wrong." Every field starts
 * from LinkImport::ProfileDraft's draft and can be edited freely before "Use this" is pressed —
 * nothing is saved anywhere until then (the caller decides what "Use this" means: fill the rest
 * of sign-up, or POST /api/library/import).
 */
export function ProfileDraftReview({ result, onUse, onSkip, useLabel = 'Use this' }: DraftReviewProps) {
  const { draft, sources, aiUsed, provenance } = result;
  const [state, setState] = useState<EditableState>(() => toEditableState(draft));
  const label = (key: string) => sourceLabel(provenance[key], sources);

  return (
    <div
      className="space-y-5 rounded-2xl border border-violet-400/30 bg-violet-500/[.06] p-5"
      data-testid="draft-review-card"
    >
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Sparkles aria-hidden="true" size={16} className="text-violet-300" />
          We drafted this from your links. Fix anything wrong.
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {aiUsed
            ? 'Drafted with AI from your links — check names, credits and numbers.'
            : 'Drafted from your links without AI — edit freely.'}
        </p>
      </div>

      <LinkFindings result={result} />

      <div>
        <label htmlFor="draft-headline" className="text-sm font-medium text-slate-200">
          Headline
          <SourceChip label={label('headline')} />
        </label>
        <Input
          id="draft-headline"
          value={state.headline}
          maxLength={80}
          onChange={(event) => setState({ ...state, headline: event.target.value })}
          className="mt-1.5 border-white/15 bg-black/20"
        />
      </div>

      <div>
        <label htmlFor="draft-bio" className="text-sm font-medium text-slate-200">
          Bio
          <SourceChip label={label('bio')} />
        </label>
        <Textarea
          id="draft-bio"
          value={state.bio}
          maxLength={600}
          rows={4}
          onChange={(event) => setState({ ...state, bio: event.target.value })}
          className="mt-1.5 border-white/15 bg-black/20"
        />
      </div>

      <AutocompleteInput
        id="draft-roles"
        field="roles"
        label="Roles"
        maxLength={ROLE_MAX_LENGTH}
        values={state.roles}
        onChange={(roles) => setState({ ...state, roles })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="draft-city" className="text-sm font-medium text-slate-200">
            City
            <SourceChip label={label('city')} />
          </label>
          <Input
            id="draft-city"
            value={state.city}
            maxLength={80}
            onChange={(event) => setState({ ...state, city: event.target.value })}
            className="mt-1.5 border-white/15 bg-black/20"
          />
        </div>
        <div>
          <label htmlFor="draft-years" className="text-sm font-medium text-slate-200">
            Years of experience
          </label>
          <Input
            id="draft-years"
            type="number"
            inputMode="numeric"
            min={0}
            max={80}
            value={state.years}
            onChange={(event) => setState({ ...state, years: event.target.value })}
            className="mt-1.5 border-white/15 bg-black/20"
          />
        </div>
      </div>

      {state.items.length > 0 && (
        <div>
          <p className="text-sm font-medium text-slate-200">Work items</p>
          <ul className="mt-2 space-y-2">
            {state.items.map((item, index) => (
              <li key={item.url} className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-2.5">
                {thumbnailFor(item.url, sources) ? (
                  <img
                    src={thumbnailFor(item.url, sources) ?? undefined}
                    alt=""
                    width={72}
                    height={40}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-10 w-[72px] shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    aria-label={`Item ${index + 1} title`}
                    value={item.title}
                    maxLength={80}
                    onChange={(event) => {
                      const items = state.items.slice();
                      items[index] = { ...item, title: event.target.value };
                      setState({ ...state, items });
                    }}
                    className="h-8 border-white/15 bg-black/20 text-sm"
                  />
                  <Input
                    aria-label={`Item ${index + 1} caption`}
                    value={item.caption}
                    maxLength={160}
                    placeholder="Caption"
                    onChange={(event) => {
                      const items = state.items.slice();
                      items[index] = { ...item, caption: event.target.value };
                      setState({ ...state, items });
                    }}
                    className="h-8 border-white/15 bg-black/20 text-sm"
                  />
                  <span className="text-xs text-slate-400">{sourceLabel(item.url, sources) ?? item.url}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" onClick={onSkip} data-testid="draft-skip">
          Skip
        </Button>
        <Button
          type="button"
          className="bg-violet-600 text-white hover:bg-violet-500 sm:ml-auto"
          data-testid="draft-use"
          onClick={() => onUse(toProfileDraft(state, draft))}
        >
          {useLabel}
        </Button>
      </div>
    </div>
  );
}

/** One line per pasted link: what we read from it, or why we could not. */
function LinkFindings({ result }: { result: DraftResult }) {
  const { sources, provenance } = result;
  const failures = result.failures ?? [];
  if (sources.length === 0 && failures.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-slate-200">What we found in each link</p>
      <ul className="mt-2 space-y-1.5" data-testid="draft-link-findings">
        {sources.map((source) => {
          const found = foundInLink(source.url, provenance);
          return (
            <li key={source.url} className="text-xs text-slate-300">
              <span className="font-medium text-white">{source.title || source.label || source.url}</span>
              {' · '}
              {found.length > 0
                ? `found ${found.slice(0, 4).join(', ')}`
                : 'added as a work link; nothing else to read from it'}
            </li>
          );
        })}
        {failures.map((failure) => (
          <li key={failure.url} role="alert" className="text-xs text-rose-300">
            <span className="break-all font-medium">{failure.url}</span>
            {' · '}
            {failure.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface EditableItem {
  url: string;
  title: string;
  caption: string;
}

interface EditableState {
  headline: string;
  bio: string;
  roles: string[];
  city: string;
  years: string;
  items: EditableItem[];
}

function toEditableState(draft: ProfileDraft): EditableState {
  return {
    headline: draft.headline ?? '',
    bio: draft.bio ?? '',
    roles: draft.roles,
    city: draft.city ?? '',
    years: draft.yearsExperience != null ? String(draft.yearsExperience) : '',
    items: draft.items.map((item) => ({ url: item.url, title: item.title ?? '', caption: item.caption ?? '' })),
  };
}

// Genres, instruments and credits aren't edited in this card, but "Use this" still carries them
// through unchanged from the original draft — only headline/bio/roles/city/years/items are ever
// touched here.
function toProfileDraft(state: EditableState, draft: ProfileDraft): ProfileDraft {
  return {
    headline: state.headline.trim() || null,
    bio: state.bio.trim() || null,
    roles: state.roles,
    genres: draft.genres,
    instruments: draft.instruments,
    city: state.city.trim() || null,
    yearsExperience: state.years.trim() ? Number(state.years) : null,
    credits: draft.credits,
    items: state.items.map((item) => ({
      url: item.url,
      title: item.title.trim() || null,
      caption: item.caption.trim() || null,
    })),
  };
}

// A default export as well, so callers can `lazy(() => import('./ProfileDraftReview'))` it —
// it pulls in the roles autocomplete, so it only loads once there's at least one pasted link.
export default ProfileDraftReview;
