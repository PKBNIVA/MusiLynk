import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';
import { Button } from './ui/button';
import type { SearchMeta } from '../lib/apiTypes';

/**
 * Says how a search was read when it was not taken literally: a corrected misspelling
 * ("Showing results for guitarist") or a partial match (not every word matched).
 */
export function SearchNotice({ meta, query }: { meta: SearchMeta; query: string }) {
  if (meta.matchMode === 'corrected' && meta.didYouMean) {
    return (
      <p className="text-sm text-slate-300 mt-4" role="status" data-testid="search-notice">
        Showing results for <strong className="text-white">{meta.didYouMean}</strong>. Nothing matched “{query}”.
      </p>
    );
  }
  if (meta.matchMode === 'partial') {
    return (
      <p className="text-sm text-slate-300 mt-4" role="status" data-testid="search-notice">
        Nothing matched every word of “{query}”, so these match some of them
        {meta.didYouMean ? (
          <>
            {' '}
            (read as <strong className="text-white">{meta.didYouMean}</strong>)
          </>
        ) : null}
        .
      </p>
    );
  }
  return null;
}

type NoResultsProps = {
  /** What was searched ('' for filters only). */
  query: string;
  meta?: SearchMeta;
  /** Shown when any filter or query is set. */
  onClear?: () => void;
  /** Runs a suggested search (did-you-mean or a popular term). */
  onSearch?: (term: string) => void;
  /** Popular searches offered when nothing matched. */
  suggestions?: readonly string[];
  /** Extra actions (e.g. "Post an opportunity"). */
  children?: ReactNode;
  noun: string;
  /** Heading when nothing was typed (default "No exact matches"). */
  title?: string;
};

/** The empty state for every search list: what found nothing, a suggestion, and a way out. */
export function NoResults({
  query,
  meta,
  onClear,
  onSearch,
  suggestions = [],
  children,
  noun,
  title = 'No exact matches',
}: NoResultsProps) {
  const suggestion = meta?.didYouMean && meta.didYouMean !== query ? meta.didYouMean : '';
  return (
    <div className="text-center py-14" data-testid="no-results">
      <SearchX className="mx-auto text-slate-500" size={32} aria-hidden="true" />
      <h2 className="text-lg font-semibold mt-3">{query ? `No ${noun} found for “${query}”` : title}</h2>
      {suggestion && onSearch ? (
        <p className="text-slate-300 mt-2">
          Did you mean{' '}
          <button
            type="button"
            className="text-violet-300 underline font-semibold"
            onClick={() => onSearch(suggestion)}
          >
            {suggestion}
          </button>
          ?
        </p>
      ) : (
        <p className="text-slate-400 mt-2">Try a broader role, instrument, genre or city, or remove a filter.</p>
      )}
      {onSearch && suggestions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mt-4" aria-label="Popular searches">
          {suggestions.map((term) => (
            <Button key={term} size="sm" variant="outline" onClick={() => onSearch(term)}>
              {term}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-3 mt-5">
        {onClear && (
          <Button variant="secondary" onClick={onClear}>
            Clear search and filters
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}

/** Popular searches offered by empty states. */
export const POPULAR_SEARCHES = [
  'vocalist',
  'guitarist',
  'music producer',
  'FOH engineer',
  'tabla',
  'wedding band',
] as const;
