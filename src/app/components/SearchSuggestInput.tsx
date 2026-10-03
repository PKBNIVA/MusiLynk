import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { searchSuggest } from '../lib/searchSuggest';
import type { SearchSuggestion } from '../lib/apiTypes';
import { cn } from './ui/utils';

/** Wait after the last keystroke before asking the API. */
export const SUGGEST_DEBOUNCE_MS = 150;
/** Shorter text gets no suggestions (the API answers [] too). */
export const SUGGEST_MIN_LENGTH = 2;

const KIND_LABELS: Record<SearchSuggestion['kind'], string> = {
  role: 'Role',
  instrument: 'Instrument',
  genre: 'Genre',
  event: 'Event',
  act_type: 'Act type',
  city: 'City',
  name: 'Musician',
  act: 'Act',
};

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onSelect' | 'role'>;

export interface SearchSuggestInputProps extends InputProps {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  /** A suggestion was chosen (click, tap, or Enter on the highlighted one). */
  onSelect: (suggestion: SearchSuggestion) => void;
  /** Classes for the wrapper (positioning); `className` styles the input. */
  wrapperClassName?: string;
  debounceMs?: number;
}

/**
 * A search box with type-ahead from GET /api/search/suggest: roles, instruments, genres, events,
 * cities, people and acts that start with what was typed (Hindi and Hinglish spellings included).
 * ARIA 1.2 combobox with a listbox: ArrowDown/ArrowUp move through the suggestions, Enter picks the
 * highlighted one (or submits the form when none is), Escape closes the list. Requests are
 * debounced (150 ms) and only the latest answer is shown.
 */
export function SearchSuggestInput({
  id,
  value,
  onValueChange,
  onSelect,
  wrapperClassName,
  className,
  debounceMs = SUGGEST_DEBOUNCE_MS,
  onKeyDown,
  onBlur,
  onFocus,
  ...inputProps
}: SearchSuggestInputProps) {
  const listboxId = `${id}-suggestions`;
  const statusId = useId();
  const [options, setOptions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  function request(text: string) {
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    const query = text.trim();
    if (query.length < SUGGEST_MIN_LENGTH) {
      seq.current += 1;
      setOptions([]);
      setActive(-1);
      return;
    }
    timer.current = setTimeout(() => {
      const abort = new AbortController();
      controller.current = abort;
      const mine = ++seq.current;
      searchSuggest(query, abort.signal)
        .then((result) => {
          if (mine !== seq.current) return;
          setOptions(Array.isArray(result.suggestions) ? result.suggestions : []);
          setActive(-1);
        })
        .catch(() => {
          // Type-ahead is a convenience: a failed or aborted lookup just shows no list.
          if (mine === seq.current) setOptions([]);
        });
    }, debounceMs);
  }

  function choose(suggestion: SearchSuggestion) {
    setOpen(false);
    setActive(-1);
    setOptions([]);
    onSelect(suggestion);
  }

  const expanded = open && options.length > 0;
  const activeId = expanded && active >= 0 ? `${listboxId}-${active}` : undefined;

  return (
    <div className={cn('relative', wrapperClassName)}>
      <input
        {...inputProps}
        id={id}
        role="combobox"
        type="search"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-describedby={statusId}
        value={value}
        className={className}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          request(event.target.value);
        }}
        onFocus={(event) => {
          setOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && options.length) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + 1) % options.length);
          } else if (event.key === 'ArrowUp' && options.length) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index <= 0 ? options.length - 1 : index - 1));
          } else if (event.key === 'Enter' && expanded && active >= 0) {
            event.preventDefault();
            choose(options[active]);
          } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
          }
          onKeyDown?.(event);
        }}
      />
      <span id={statusId} className="sr-only" aria-live="polite">
        {expanded ? `${options.length} suggestions. Use the up and down arrows to choose one.` : ''}
      </span>
      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-[#0d0f1f] py-1 shadow-2xl"
        >
          {options.map((option, index) => (
            <li
              key={`${option.kind}-${option.url ?? option.label}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: picking must happen before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-sm text-slate-200',
                index === active && 'bg-violet-400/15 text-white',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{option.label}</span>
                {option.detail && <span className="block truncate text-xs text-slate-400">{option.detail}</span>}
              </span>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">
                {KIND_LABELS[option.kind] ?? option.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Where a picked suggestion goes: a person's or act's page, or a search for the term. */
export const suggestionPath = (suggestion: SearchSuggestion) =>
  suggestion.url ?? `/search?q=${encodeURIComponent(suggestion.query ?? suggestion.label)}`;
