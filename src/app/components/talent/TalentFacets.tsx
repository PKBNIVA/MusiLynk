import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

/** The India-first facets, as the API's own filter names (`language`, `eventType`, `genre`, `budgetMax`). */
export const FACET_KEYS = ['language', 'eventType', 'genre', 'budgetMax'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

type Option = { value: string; label: string };

const plain = (labels: string[]): Option[] => labels.map((label) => ({ value: label, label }));

export const LANGUAGE_OPTIONS = plain([
  'Hindi',
  'English',
  'Marathi',
  'Punjabi',
  'Bengali',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Gujarati',
]);

// The value is matched as a word inside the stored event types ("private" finds "private-party").
export const EVENT_OPTIONS: Option[] = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'sangeet', label: 'Sangeet' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'private', label: 'Private party' },
  { value: 'concert', label: 'Concert' },
  { value: 'festival', label: 'Festival' },
  { value: 'religious', label: 'Religious' },
  { value: 'studio', label: 'Studio session' },
  { value: 'film', label: 'Film & OTT' },
];

export const GENRE_OPTIONS = plain([
  'Bollywood',
  'Sufi',
  'Ghazal',
  'Qawwali',
  'Bhajan',
  'Carnatic',
  'Hindustani',
  'Indie',
  'Jazz',
  'EDM',
  'Hip-Hop',
  'Folk',
]);

export const BUDGET_OPTIONS: Option[] = [
  { value: '5000', label: 'Up to ₹5,000' },
  { value: '10000', label: 'Up to ₹10,000' },
  { value: '25000', label: 'Up to ₹25,000' },
  { value: '50000', label: 'Up to ₹50,000' },
];

const GROUPS: { key: FacetKey; label: string; options: Option[] }[] = [
  { key: 'language', label: 'Language', options: LANGUAGE_OPTIONS },
  { key: 'eventType', label: 'Event', options: EVENT_OPTIONS },
  { key: 'genre', label: 'Genre', options: GENRE_OPTIONS },
  { key: 'budgetMax', label: 'Budget', options: BUDGET_OPTIONS },
];

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 text-sm ${
        pressed
          ? 'border-violet-400 bg-violet-500/20 text-white'
          : 'border-white/15 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'
      }`}
    >
      {children}
    </button>
  );
}

type Props = {
  values: Record<FacetKey, string>;
  update: (changes: Partial<Record<FacetKey, string>>) => boolean;
};

/**
 * Language, event, genre and budget chips behind one "More filters" button (open when a facet is
 * already chosen). One value per facet; pressing the chosen chip clears it.
 */
export function TalentFacets({ values, update }: Props) {
  const active = FACET_KEYS.filter((key) => values[key]).length;
  const [open, setOpen] = useState(active > 0);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open || active > 0}
        aria-controls="talent-facets"
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[.04] px-3.5 text-sm text-slate-300 hover:bg-white/[.08]"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        More filters{active > 0 ? ` (${active})` : ''}
      </button>
      {(open || active > 0) && (
        <div id="talent-facets" className="mt-3 grid grid-cols-1 gap-3">
          {GROUPS.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="flex min-w-0 items-center gap-3">
              <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-slate-500">{group.label}</span>
              <div className="-mr-5 flex min-w-0 snap-x flex-nowrap gap-2 overflow-x-auto pr-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:flex-wrap md:overflow-visible md:pr-0">
                {group.options.map((option) => (
                  <Chip
                    key={option.value}
                    pressed={values[group.key].toLowerCase() === option.value.toLowerCase()}
                    onClick={() =>
                      update({
                        [group.key]: values[group.key].toLowerCase() === option.value.toLowerCase() ? '' : option.value,
                      })
                    }
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
