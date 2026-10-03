import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False in the build-time pre-render and during the hydration render of pre-rendered HTML, true from
 * the very next render on (React re-renders synchronously, before paint); true from the first render in
 * a page that was not pre-rendered. Anything the HTML cannot know (the URL's query string, storage, the
 * clock) is read only when this is true, so the first client render matches the HTML byte for byte.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
