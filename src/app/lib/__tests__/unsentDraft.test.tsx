import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUnsentDraft as register, saveUnsentDrafts, takeUnsentDraft, useUnsentDraft } from '../unsentDraft';

const KEY = 'musilynk_unsent_drafts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The registry is module-level state: every registration made by a test is undone after it.
const stops: Array<() => void> = [];
const registerUnsentDraft = (key: string, read: () => string) => {
  const stop = register(key, read);
  stops.push(stop);
  return stop;
};

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  while (stops.length) stops.pop()!();
});

describe('unsent drafts', () => {
  it('saves registered, non-empty text and hands it back exactly once', () => {
    const stop = registerUnsentDraft('a', () => 'Hello from the Stage');
    registerUnsentDraft('blank', () => '   ');
    saveUnsentDrafts();
    stop();

    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ a: 'Hello from the Stage' });
    expect(takeUnsentDraft('a')).toBe('Hello from the Stage');
    expect(takeUnsentDraft('a')).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps other drafts when one is taken, and merges with drafts already stored', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ old: 'earlier' }));
    registerUnsentDraft('new', () => 'later');
    saveUnsentDrafts();
    expect(takeUnsentDraft('new')).toBe('later');
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ old: 'earlier' });
  });

  it('writes nothing when no form has text, and ignores a stale unregister', () => {
    const first = () => 'one';
    const stopFirst = registerUnsentDraft('k', first);
    registerUnsentDraft('k', () => '');
    stopFirst(); // the second registration owns the key now
    saveUnsentDrafts();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('survives corrupt storage and a store that refuses writes', () => {
    sessionStorage.setItem(KEY, '{not json');
    expect(takeUnsentDraft('x')).toBeNull();
    sessionStorage.setItem(KEY, '[1,2]');
    expect(takeUnsentDraft('x')).toBeNull();

    sessionStorage.setItem(KEY, JSON.stringify({ x: 'kept' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(takeUnsentDraft('x')).toBe('kept');
    const stop = registerUnsentDraft('y', () => 'text');
    expect(() => saveUnsentDrafts()).not.toThrow();
    stop();
  });

  it('useUnsentDraft restores a saved draft on mount and exposes the live value to the saver', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ composer: 'restored text' }));
    const restore = vi.fn();
    const { render, unmount } = mount(restore);
    render('');
    expect(restore).toHaveBeenCalledWith('restored text');

    render('typed since');
    saveUnsentDrafts();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ composer: 'typed since' });

    unmount();
    sessionStorage.clear();
    saveUnsentDrafts();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('useUnsentDraft does nothing while disabled', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ composer: 'keep me' }));
    const restore = vi.fn();
    const { render, unmount } = mount(restore, false);
    render('typed');
    expect(restore).not.toHaveBeenCalled();
    saveUnsentDrafts();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ composer: 'keep me' });
    unmount();
  });
});

function Probe({ value, restore, enabled }: { value: string; restore: (text: string) => void; enabled: boolean }) {
  useUnsentDraft('composer', value, restore, enabled);
  return null;
}

function mount(restore: (text: string) => void, enabled = true) {
  const root = createRoot(document.createElement('div'));
  return {
    render: (value: string) => act(() => root.render(<Probe value={value} restore={restore} enabled={enabled} />)),
    unmount: () => act(() => root.unmount()),
  };
}
