import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a function with a stable identity that always runs the latest `fn`.
 *
 * Use it for loaders that read the current form state but must only run when an
 * effect says so (on mount, or when a specific filter changes). Listing the result in
 * an effect's dependencies never re-triggers the effect, so typing into a search box
 * does not fire a request per keystroke. This is React's `useEffectEvent` pattern for
 * React 18, which does not ship that hook.
 */
export function useLatestCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
