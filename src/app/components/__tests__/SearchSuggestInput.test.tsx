import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSuggestInput, suggestionPath, SUGGEST_DEBOUNCE_MS } from '../SearchSuggestInput';
import type { SearchSuggestion } from '../../lib/apiTypes';

vi.mock('../../lib/searchSuggest', () => ({ searchSuggest: vi.fn() }));
import { searchSuggest } from '../../lib/searchSuggest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const picked: SearchSuggestion[] = [];
const submitted = vi.fn();

const TABLA: SearchSuggestion = { kind: 'role', label: 'Tabla player', query: 'Tabla player' };
const NAME: SearchSuggestion = {
  kind: 'name',
  label: 'Tabassum Ali',
  detail: 'Singer from Pune',
  url: '/professionals/u1',
};

function Harness() {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted(value);
      }}
    >
      <label htmlFor="box">Search</label>
      <SearchSuggestInput id="box" value={value} onValueChange={setValue} onSelect={(s) => picked.push(s)} />
    </form>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  picked.length = 0;
  submitted.mockReset();
  vi.mocked(searchSuggest).mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const input = () => container.querySelector('input') as HTMLInputElement;
const options = () => [...container.querySelectorAll('[role="option"]')];

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    input().focus();
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function press(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('SearchSuggestInput', () => {
  it('asks once, 150 ms after the last keystroke, and lists the answers in a labelled listbox', async () => {
    vi.mocked(searchSuggest).mockResolvedValue({ suggestions: [TABLA, NAME] });
    type('t');
    type('ta');
    type('tab');
    await wait(SUGGEST_DEBOUNCE_MS - 1);
    expect(searchSuggest).not.toHaveBeenCalled();
    await wait(1);
    expect(searchSuggest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchSuggest).mock.calls[0][0]).toBe('tab');
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.id).toBe(input().getAttribute('aria-controls'));
    expect(options().map((o) => o.textContent)).toEqual(['Tabla playerRole', 'Tabassum AliSinger from PuneMusician']);
  });

  it('never asks for fewer than two characters and drops answers that arrive after newer typing', async () => {
    type('t');
    await wait(500);
    expect(searchSuggest).not.toHaveBeenCalled();

    let resolveOld!: (value: { suggestions: SearchSuggestion[] }) => void;
    vi.mocked(searchSuggest)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ suggestions: [NAME] });
    type('ta');
    await wait(SUGGEST_DEBOUNCE_MS);
    type('tabas');
    await wait(SUGGEST_DEBOUNCE_MS);
    await act(async () => resolveOld({ suggestions: [TABLA] }));
    expect(options().map((o) => o.textContent)).toEqual(['Tabassum AliSinger from PuneMusician']);
  });

  it('moves with the arrow keys, picks with Enter, and closes with Escape', async () => {
    vi.mocked(searchSuggest).mockResolvedValue({ suggestions: [TABLA, NAME] });
    type('tab');
    await wait(SUGGEST_DEBOUNCE_MS);
    press('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    press('ArrowDown');
    press('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id); // wraps
    press('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    press('Escape');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');

    press('ArrowDown');
    press('Enter');
    expect(picked).toEqual([TABLA]);
    expect(submitted).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('Enter with nothing highlighted submits the form as typed; a tap picks a suggestion', async () => {
    vi.mocked(searchSuggest).mockResolvedValue({ suggestions: [TABLA, NAME] });
    type('tab');
    await wait(SUGGEST_DEBOUNCE_MS);
    act(() => {
      input().form!.requestSubmit();
    });
    expect(submitted).toHaveBeenCalledWith('tab');
    act(() => {
      options()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(picked).toEqual([NAME]);
  });

  it('a failed lookup shows no list instead of an error', async () => {
    vi.mocked(searchSuggest).mockRejectedValue(new Error('offline'));
    type('tab');
    await wait(SUGGEST_DEBOUNCE_MS);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('sends people and acts to their page and terms to a search', () => {
    expect(suggestionPath(NAME)).toBe('/professionals/u1');
    expect(suggestionPath(TABLA)).toBe('/search?q=Tabla%20player');
    expect(suggestionPath({ kind: 'city', label: 'Mumbai' })).toBe('/search?q=Mumbai');
  });
});
