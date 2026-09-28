import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useActingAsKey } from '../../lib/actingAs';
import { SUGGESTIONS_CHANGED_EVENT } from '../../lib/showcase';

/** The pending "Review changes" count for the identity being acted as; refreshes on switch or change. */
export function usePendingSuggestions(enabled: boolean) {
  const key = useActingAsKey();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () =>
      apiGet<{ pending?: number }>('/suggestions?status=pending')
        .then((d) => live && setPending(Number(d.pending) || 0))
        .catch(() => undefined);
    void load();
    window.addEventListener(SUGGESTIONS_CHANGED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SUGGESTIONS_CHANGED_EVENT, load);
    };
  }, [enabled, key]);
  return pending;
}
