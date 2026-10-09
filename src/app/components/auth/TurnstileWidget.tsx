import { useEffect, useRef } from 'react';
import { loadTurnstile, turnstileSiteKey } from '../../lib/turnstile';

interface Props {
  /** Names the form for Cloudflare's analytics ("sign-up", "otp-request"); letters, digits, - and _ only. */
  action: string;
  /** Called with a fresh token, and with null when the token expires or the widget errors. */
  onToken: (token: string | null) => void;
}

/**
 * The Cloudflare Turnstile challenge for a form. Renders nothing at all (no script, no network)
 * unless the build has VITE_TURNSTILE_SITE_KEY; see src/app/lib/turnstile.ts. Remount it (change
 * its `key`) after each submit: a token is single-use.
 */
export function TurnstileWidget({ action, onToken }: Props) {
  const siteKey = turnstileSiteKey();
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onToken);
  latest.current = onToken;

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          size: 'flexible',
          callback: (token) => latest.current(token),
          'expired-callback': () => latest.current(null),
          'error-callback': () => latest.current(null),
        });
      })
      .catch(() => latest.current(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action]);

  if (!siteKey) return null;
  return <div ref={container} data-testid="turnstile" className="min-h-[65px]" aria-live="polite" />;
}
