import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Field, FormError, RequiredNote, fieldErrorId, fieldHintId } from '../Field';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $ = (selector: string) => container.querySelector(selector);

describe('Field', () => {
  it('binds a visible label to the control and marks it required', () => {
    act(() =>
      root.render(
        <Field id="company" label="Company name" required>
          <input />
        </Field>,
      ),
    );
    const input = $('input')!;
    expect(input.id).toBe('company');
    expect($('label')!.getAttribute('for')).toBe('company');
    expect($('label')!.textContent).toBe('Company name* (required)');
    expect($('label [aria-hidden="true"]')!.textContent).toBe('*');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect($('[role="alert"]')).toBeNull();
  });

  it('shows the error with role=alert and links hint and error to the control', () => {
    act(() =>
      root.render(
        <Field id="site" label="Website" hint="Include https://" error="Enter a full URL">
          <input aria-describedby="extra" />
        </Field>,
      ),
    );
    const input = $('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(`extra ${fieldHintId('site')} ${fieldErrorId('site')}`);
    expect($(`#${fieldErrorId('site')}`)!.getAttribute('role')).toBe('alert');
    expect($(`#${fieldErrorId('site')}`)!.textContent).toBe('Enter a full URL');
    expect($(`#${fieldHintId('site')}`)!.textContent).toBe('Include https://');
  });

  it('passes the control props to a render function and shows optional and a counter', () => {
    act(() =>
      root.render(
        <Field id="bio" label="Bio" optional count={2_001} maxLength={2_000}>
          {(control) => <textarea {...control} />}
        </Field>,
      ),
    );
    expect($('textarea')!.id).toBe('bio');
    expect($('label')!.textContent).toBe('Bio(optional)');
    const counter = $('[data-testid="bio-count"]')!;
    expect(counter.textContent).toBe('2,001 / 2,000');
    expect(counter.className).toContain('text-rose-300');
  });

  it('renders non-element children unchanged', () => {
    act(() =>
      root.render(
        <Field id="x" label="X" maxLength={10}>
          {'plain' as unknown as React.ReactElement<{ id?: string }>}
        </Field>,
      ),
    );
    expect(container.textContent).toContain('plain');
    expect($('[data-testid="x-count"]')).toBeNull();
  });
});

describe('FormError and RequiredNote', () => {
  it('renders a form-level alert only when there is a message', () => {
    act(() => root.render(<FormError message="" />));
    expect($('[role="alert"]')).toBeNull();
    act(() => root.render(<FormError message="Could not save" />));
    expect($('[role="alert"]')!.textContent).toBe('Could not save');
  });

  it('explains the asterisk', () => {
    act(() => root.render(<RequiredNote />));
    expect(container.textContent).toBe('Fields marked *with an asterisk are required.');
  });
});
