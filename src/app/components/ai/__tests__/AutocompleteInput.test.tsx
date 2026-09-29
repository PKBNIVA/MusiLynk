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
    // No chip row for a single-value field: the committed value is the input's own text.
    expect($('ul[aria-label="Selected city"]')).toBeNull();
    expect(input.value).toBe('Mumbai');
    typeInto(input, 'del');
    await runDebounce();
    const option = $('[role="option"]') as HTMLElement;
    act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(['Delhi']);
  });

  it('a single-value field never renders a chip <ul>, empty, typing or committed (V-02 layout-shift fix)', async () => {
    let values: string[] = [];
    const onChange = vi.fn((next: string[]) => {
      values = next;
    });
    const render = () =>
      act(() =>
        root.render(
          <AutocompleteInput field="cities" values={values} onChange={onChange} label="City" multiple={false} />,
        ),
      );
    render();
    const input = $('input') as HTMLInputElement;

    // Empty state: no <ul> anywhere in the component (that's what grows the field on commit), no clear button.
    expect(container.querySelector('ul')).toBeNull();
    expect($('button[aria-label="Clear City"]')).toBeNull();

    // Typing: still no <ul>.
    typeInto(input, 'Mumbai, Maharashtra');
    expect(container.querySelector('ul')).toBeNull();

    // Committed on blur: the input's own value becomes the committed text; still no <ul>.
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    render();
    expect(onChange).toHaveBeenCalledWith(['Mumbai, Maharashtra']);
    expect(($('input') as HTMLInputElement).value).toBe('Mumbai, Maharashtra');
    expect(container.querySelector('ul')).toBeNull();
    expect($('button[aria-label="Clear City"]')).not.toBeNull();
  });

  it('a single-value field can be cleared with the inline clear button', async () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <AutocompleteInput field="cities" values={['Mumbai']} onChange={onChange} label="City" multiple={false} />,
      ),
    );
    const clearButton = $('button[aria-label="Clear City"]') as HTMLButtonElement;
    expect(clearButton).not.toBeNull();
    act(() => clearButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(($('input') as HTMLInputElement).value).toBe('');
  });

  it('clears matches for a blank query without calling the API', async () => {
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={() => {}} label="City" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, '');
    await runDebounce();
    expect(autocompleteAi).not.toHaveBeenCalled();
    expect($('[role="listbox"]')).toBeNull();
  });

  it('commits typed free text on blur (V-02)', async () => {
    const onChange = vi.fn();
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={onChange} label="City" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, 'Mumbai, Maharashtra');
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(['Mumbai, Maharashtra']);
    expect(input.value).toBe('');
  });

  it('typing then Enter still commits once, with no double commit on a later blur', async () => {
    const onChange = vi.fn();
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={onChange} label="City" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, 'Delhi');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a clicked suggestion still commits via mousedown, unaffected by the new blur handler', async () => {
    vi.mocked(autocompleteAi).mockResolvedValue({
      field: 'cities',
      query: 'mum',
      suggestions: [{ value: 'Mumbai', source: 'taxonomy' }],
    });
    const onChange = vi.fn();
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={onChange} label="City" />));
    const input = $('input') as HTMLInputElement;
    typeInto(input, 'mum');
    await runDebounce();
    const option = $('[role="option"]') as HTMLElement;
    act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    expect(onChange).toHaveBeenCalledWith(['Mumbai']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('blurring an empty input commits nothing', async () => {
    const onChange = vi.fn();
    act(() => root.render(<AutocompleteInput field="cities" values={[]} onChange={onChange} label="City" />));
    const input = $('input') as HTMLInputElement;
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onChange).not.toHaveBeenCalled();
  });
});
