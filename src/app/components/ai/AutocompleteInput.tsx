import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { autocompleteAi, type AutocompleteField, type AutocompleteSuggestion } from '../../lib/ai';
import { cn } from '../ui/utils';

export interface AutocompleteInputProps {
  field: AutocompleteField;
  /** Selected values (chips). A single-value field still uses this shape with at most one item. */
  values: string[];
  onChange: (values: string[]) => void;
  /** Allows more than one chip. Defaults to true; pass false for a single-value field (e.g. a city). */
  multiple?: boolean;
  placeholder?: string;
  label: string;
  id?: string;
  className?: string;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * A combobox for skills/genres/instruments/roles/cities, backed by GET /api/ai/autocomplete
 * (works with no AI configured; AI only fills gaps when there are few taxonomy matches).
 * Follows the ARIA 1.2 combobox-with-listbox pattern; multi-value selections show as chips.
 */
export function AutocompleteInput({
  field,
  values,
  onChange,
  multiple = true,
  placeholder,
  label,
  id,
  className,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: AutocompleteInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listboxId = `${inputId}-listbox`;
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  function fetchOptions(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setOptions([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;
      autocompleteAi(field, text, controller.signal)
        .then((result) => {
          if (seq !== requestSeq.current) return;
          // Defensive: an unmocked/misbehaving endpoint could answer with no `suggestions` array.
          setOptions(Array.isArray(result.suggestions) ? result.suggestions : []);
          setActiveIndex(-1);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          if (seq !== requestSeq.current) return;
          setOptions([]);
          setError(caught instanceof ApiError ? caught.message : 'Could not load suggestions.');
        });
    }, debounceMs);
  }

  function selectValue(next: string, refocus = true) {
    const trimmed = next.trim();
    if (!trimmed) return;
    if (multiple) {
      if (!values.includes(trimmed)) onChange([...values, trimmed]);
    } else {
      onChange([trimmed]);
    }
    setQuery('');
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) inputRef.current?.focus();
  }

  // Commits the field's current state as Enter would, but without stealing focus back —
  // by the time this runs the user has already moved on to another control.
  function commitOnBlur() {
    if (activeIndex >= 0 && options[activeIndex]) selectValue(options[activeIndex].value, false);
    else if (query.trim()) selectValue(query, false);
  }

  function removeValue(removed: string) {
    onChange(values.filter((existing) => existing !== removed));
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((index) => (options.length ? (index + 1) % options.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (options.length ? (index - 1 + options.length) % options.length : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) selectValue(options[activeIndex].value);
      else if (query.trim()) selectValue(query);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'Backspace' && !query && values.length) {
      removeValue(values[values.length - 1]);
    }
  }

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-200">
        {label}
      </label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${label.toLowerCase()}`}>
          {values.map((chip) => (
            <li
              key={chip}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[.06] px-2.5 py-1 text-xs text-slate-100"
            >
              {chip}
              <button
                type="button"
                onClick={() => removeValue(chip)}
                aria-label={`Remove ${chip}`}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          type="text"
          autoComplete="off"
          aria-expanded={open && options.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            const text = event.target.value;
            setQuery(text);
            setOpen(true);
            fetchOptions(text);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // A suggestion clicked via onMouseDown commits (and preventDefault keeps focus,
            // so this blur never fires for it); this only handles a real, unhandled blur.
            commitOnBlur();
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-md border border-white/15 bg-white/[.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400 focus:outline-none"
        />
        {open && (options.length > 0 || error) && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-white/10 bg-slate-900 py-1 shadow-lg"
          >
            {error && (
              <li role="status" className="px-3 py-2 text-xs text-red-400">
                {error}
              </li>
            )}
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // onMouseDown (not onClick) so it fires before the input's onBlur closes the list.
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectValue(option.value);
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-slate-100 hover:bg-white/10',
                  index === activeIndex && 'bg-white/10',
                )}
              >
                <span>{option.value}</span>
                {option.source === 'ai' && <span className="text-xs text-violet-300">AI</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
