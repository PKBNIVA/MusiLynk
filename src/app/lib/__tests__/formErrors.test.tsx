import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import {
  fieldErrorsFromApi,
  focusFirstInvalid,
  hasErrors,
  isHttpUrl,
  isPhone,
  useFormErrors,
  useSubmitOnce,
} from '../formErrors';

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

describe('fieldErrorsFromApi', () => {
  it('keeps the first message per field and renames API fields', () => {
    expect(
      fieldErrorsFromApi(
        { companyName: ['Name is required', 'second'], phone: ['Bad phone'] },
        { companyName: 'name' },
      ),
    ).toEqual({ name: 'Name is required', phone: 'Bad phone' });
  });

  it('returns an empty map without fields and never overwrites an earlier message', () => {
    expect(fieldErrorsFromApi(undefined)).toEqual({});
    expect(fieldErrorsFromApi({ a: ['first'], b: ['second'] }, { b: 'a' })).toEqual({ a: 'first' });
    expect(fieldErrorsFromApi({ a: [] })).toEqual({});
  });
});

describe('hasErrors', () => {
  it('ignores empty messages', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ a: '' })).toBe(false);
    expect(hasErrors({ a: 'x' })).toBe(true);
  });
});

describe('focusFirstInvalid', () => {
  it('focuses the first invalid control in document order, not in map order', () => {
    container.innerHTML = '<input id="first"><input id="second"><input id="third">';
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const focused = focusFirstInvalid({ third: 'x', second: 'y', missing: 'z', first: '' });
    expect(focused?.id).toBe('second');
    expect(document.activeElement?.id).toBe('second');
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('maps field names to ids and returns null when nothing matches', () => {
    container.innerHTML = '<input id="profile-website">';
    expect(focusFirstInvalid({ website: 'bad' }, (name) => `profile-${name}`)?.id).toBe('profile-website');
    expect(focusFirstInvalid({ nothing: 'bad' })).toBeNull();
    expect(focusFirstInvalid({})).toBeNull();
  });
});

type Hook = ReturnType<typeof useFormErrors<'name' | 'website'>>;

function renderHook(options: Parameters<typeof useFormErrors<'name' | 'website'>>[0] = {}) {
  const ref: { current: Hook | null } = { current: null };
  function Probe() {
    const form = useFormErrors<'name' | 'website'>(options);
    ref.current = form;
    return (
      <form>
        <input id="org-name" aria-invalid={form.errors.name ? true : undefined} />
        <input id="website" aria-invalid={form.errors.website ? true : undefined} />
        <p data-testid="form-error">{form.formError}</p>
      </form>
    );
  }
  act(() => root.render(<Probe />));
  return () => ref.current!;
}

describe('useFormErrors', () => {
  it('sets, reports and clears field errors, and focuses the first invalid field', () => {
    const form = renderHook({ ids: { name: 'org-name' } });
    let any = false;
    act(() => {
      any = form().setErrors({ website: 'Enter a full URL', name: 'Name is required' });
      form().focusFirst();
    });
    expect(any).toBe(true);
    expect(form().errors).toEqual({ website: 'Enter a full URL', name: 'Name is required' });
    expect(form().errorFor('name')).toBe('Name is required');
    expect(document.activeElement?.id).toBe('org-name');
    expect(container.querySelector('#org-name')?.getAttribute('aria-invalid')).toBe('true');

    act(() => form().clear('name'));
    expect(form().errors).toEqual({ website: 'Enter a full URL' });
    const before = form().errors;
    act(() => form().clear('name'));
    expect(form().errors).toBe(before);

    act(() => form().setFieldError('name', 'Again'));
    expect(form().errors.name).toBe('Again');
    act(() => form().setFieldError('name', ''));
    expect(form().errors.name).toBeUndefined();

    act(() => {
      form().setFormError('Whole form');
      form().clear();
    });
    expect(form().errors).toEqual({});
    expect(form().formError).toBe('');
    let none = true;
    act(() => {
      none = form().setErrors({});
    });
    expect(none).toBe(false);
  });

  it('derives control ids with idFor', () => {
    const form = renderHook({ idFor: (name) => (name === 'name' ? 'org-name' : name) });
    act(() => {
      form().setErrors({ name: 'Required' });
      form().focusFirst();
    });
    expect(document.activeElement?.id).toBe('org-name');
  });

  it('places API field errors on the form fields and leaves the form error empty', () => {
    const form = renderHook({ apiFields: { companyName: 'name' } });
    let placed = false;
    act(() => {
      placed = form().setFromApi(
        new ApiError('Company name is required', 422, 'VALIDATION_FAILED', undefined, {
          companyName: ['Company name is required'],
        }),
      );
    });
    expect(placed).toBe(true);
    expect(form().errors).toEqual({ name: 'Company name is required' });
    expect(form().formError).toBe('');
  });

  it('shows a message that names no field as the form error', () => {
    const form = renderHook();
    let placed = true;
    act(() => {
      placed = form().setFromApi(new ApiError('Incorrect email or password.', 401));
    });
    expect(placed).toBe(false);
    expect(form().formError).toBe('Incorrect email or password.');
    act(() => {
      form().setFromApi({});
    });
    expect(form().formError).toBe('Something went wrong. Please try again.');
    act(() => {
      form().setFromApi(null, 'Could not save.');
    });
    expect(container.querySelector('[data-testid="form-error"]')?.textContent).toBe('Could not save. Try again.');
  });
});

describe('useSubmitOnce', () => {
  function renderSubmit() {
    const ref: { current: ReturnType<typeof useSubmitOnce> | null } = { current: null };
    function Probe() {
      const submit = useSubmitOnce();
      ref.current = submit;
      return <button disabled={submit.busy}>Save</button>;
    }
    act(() => root.render(<Probe />));
    return () => ref.current!;
  }

  it('runs one task at a time even when called three times in the same tick', async () => {
    const submit = renderSubmit();
    let resolve: (value: string) => void = () => undefined;
    const task = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    let results: Array<Promise<string | undefined>> = [];
    act(() => {
      const { run } = submit();
      results = [run(task), run(task), run(task)];
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(submit().busy).toBe(true);
    expect(container.querySelector('button')?.disabled).toBe(true);
    await act(async () => {
      resolve('saved');
      await results[0];
    });
    expect(await results[0]).toBe('saved');
    expect(await results[1]).toBeUndefined();
    expect(submit().busy).toBe(false);
    await act(async () => {
      await submit().run(async () => 'again');
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('releases the guard when the task fails', async () => {
    const submit = renderSubmit();
    await act(async () => {
      await expect(
        submit().run(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
    expect(submit().busy).toBe(false);
    let second: string | undefined;
    await act(async () => {
      second = await submit().run(async () => 'ok');
    });
    expect(second).toBe('ok');
  });
});

describe('value checks', () => {
  it('accepts only absolute http(s) URLs without credentials', () => {
    expect(isHttpUrl('https://musilynk.example/about')).toBe(true);
    expect(isHttpUrl('  http://studio.example  ')).toBe(true);
    expect(isHttpUrl('musilynk.example')).toBe(false);
    expect(isHttpUrl('javascript:void(0)')).toBe(false);
    expect(isHttpUrl('https://user:pw@musilynk.example')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('accepts common phone formats and rejects junk', () => {
    expect(isPhone('+91 98765 43210')).toBe(true);
    expect(isPhone('(022) 2345-6789')).toBe(true);
    expect(isPhone('abc-😀')).toBe(false);
    expect(isPhone('12345')).toBe(false);
    expect(isPhone('+1234567890123456')).toBe(false);
  });
});
