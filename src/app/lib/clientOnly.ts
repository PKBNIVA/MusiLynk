import { useEffect, useState } from 'react';

/**
 * False during the first render (and in the build-time pre-render), true from the first effect on.
 * A lazily loaded part of a pre-rendered page renders behind it: the server HTML then has no Suspense
 * boundary for it, so a state update while its chunk is still downloading cannot hit a boundary that is
 * only half hydrated (React error #421, which throws the pre-rendered markup away). Costs one render.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
