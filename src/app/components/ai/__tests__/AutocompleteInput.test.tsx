import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutocompleteInput } from '../AutocompleteInput';

vi.mock('../../../lib/ai', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/ai')>('../../../lib/ai');
  return { ...actual, autocompleteAi: vi.fn() };
});
import { autocompleteAi } from '../../../lib/ai';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const $ = (selector: string) => container.querySelector(selector);

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function runDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AutocompleteInput', () => {
  it('debounces requests and lists matches, taxonomy or AI, in a labelled listbox', async () => {
    vi.mocked(autocompleteAi).mockResolvedValue({
      field: 'cities',
      query: 'mum',
      suggestions: [{ value: 'Mumbai', source: 'taxonomy' }],
    });
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={() => {}} label="City" />));
    const input = $('input') as HTMLInputElement;

    typeInto(input, 'mum');
    expect(autocompleteAi).not.toHaveBeenCalled();
    await runDebounce();

    expect(autocompleteAi).toHaveBeenCalledWith('cities', 'mum', expect.anything());
    expect($('[role="listbox"]')!.textContent).toContain('Mumbai');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('selects an option with the keyboard (ArrowDown, Enter) and clears the query', async () => {
    vi.mocked(autocompleteAi).mockResolvedValue({
      field: 'skills',
      query: 'mix',
      suggestions: [{ value: 'Mixing', source: 'taxonomy' }],
    });
    let values: string[] = [];
    const onChange = vi.fn((next: string[]) => (values = next));
    act(() => root.render(<AutocompleteInput field="skills" values={values} onChange={onChange} label="Skills" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, 'mix');
    await runDebounce();

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    expect(onChange).toHaveBeenCalledWith(['Mixing']);
    expect(input.value).toBe('');
  });

  it('shows selections as removable chips and supports multiple values', async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <AutocompleteInput field="skills" values={['Mixing', 'Mastering']} onChange={onChange} label="Skills" />,
      ),
    );
    const chips = Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
    expect(chips.some((text) => text?.includes('Mixing'))).toBe(true);
    expect(chips.some((text) => text?.includes('Mastering'))).toBe(true);

    const removeButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Mixing'),
    )!;
    act(() => removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(['Mastering']);
  });

  it('a single-value field replaces rather than appends', async () => {
    vi.mocked(autocompleteAi).mockResolvedValue({
      field: 'cities',
      query: 'del',
      suggestions: [{ value: 'Delhi', source: 'taxonomy' }],
    });
    const onChange = vi.fn();
    act(() =>
      root.render(
        <AutocompleteInput field="cities" values={['Mumbai']} onChange={onChange} label="City" multiple={false} />,
      ),
    );
    const input = $('input') as HTMLInputElement;
    typeInto(input, 'del');
    await runDebounce();
    const option = $('[role="option"]') as HTMLElement;
    act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(['Delhi']);
  });

  it('clears matches for a blank query without calling the API', async () => {
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={() => {}} label="City" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, '');
    await runDebounce();
    expect(autocompleteAi).not.toHaveBeenCalled();
    expect($('[role="listbox"]')).toBeNull();
  });
});
