import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationRequestDialog, VERIFICATION_NOTE_MAX } from '../VerificationDialogs';

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

// Radix Dialog renders its content into a portal on document.body, not inside `container`.
const $ = (selector: string) => document.body.querySelector(selector);

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('VerificationRequestDialog note field (V-11)', () => {
  it('sends the note when filled in', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<VerificationRequestDialog open={true} onOpenChange={() => {}} onSubmit={onSubmit} />));
    const url = $('input[type="url"]') as HTMLInputElement;
    const note = $('textarea') as HTMLTextAreaElement;
    act(() => setNativeValue(url, 'https://example.com/proof'));
    act(() => setNativeValue(note, 'Ask the studio manager to confirm.'));

    const form = document.body.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith('https://example.com/proof', 'Ask the studio manager to confirm.');
  });

  it('sends an empty note when left blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<VerificationRequestDialog open={true} onOpenChange={() => {}} onSubmit={onSubmit} />));
    const url = $('input[type="url"]') as HTMLInputElement;
    act(() => setNativeValue(url, 'https://example.com/proof'));

    const form = document.body.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith('https://example.com/proof', '');
  });

  it('shows a character counter only past 1,800 characters', async () => {
    act(() => root.render(<VerificationRequestDialog open={true} onOpenChange={() => {}} onSubmit={vi.fn()} />));
    const note = $('textarea') as HTMLTextAreaElement;
    act(() => setNativeValue(note, 'a'.repeat(1_700)));
    await flush();
    expect(document.body.textContent).not.toContain('1,700 / 2,000');

    act(() => setNativeValue(note, 'a'.repeat(1_850)));
    await flush();
    expect(document.body.textContent).toContain('1,850 / 2,000');
  });

  it('blocks submit and shows a message when the note is over the limit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<VerificationRequestDialog open={true} onOpenChange={() => {}} onSubmit={onSubmit} />));
    const url = $('input[type="url"]') as HTMLInputElement;
    const note = $('textarea') as HTMLTextAreaElement;
    act(() => setNativeValue(url, 'https://example.com/proof'));
    act(() => setNativeValue(note, 'a'.repeat(VERIFICATION_NOTE_MAX + 1)));

    const form = document.body.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toMatch(/under 2,000 characters/);
  });
});
