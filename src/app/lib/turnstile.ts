/**
 * Cloudflare Turnstile, loaded lazily and only by the two forms that use it (sign-up and the
 * emailed sign-in code request). Off, with no script tag and no token, unless the build has
 * VITE_TURNSTILE_SITE_KEY (docs/ops/turnstile.md); the API in turn only checks tokens when its
 * own TURNSTILE_SECRET_KEY is set, so either side alone being unset is a clean no-op.
 */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (code?: string) => void;
}
export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileSiteKey(): string | null {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

let loading: Promise<TurnstileApi> | null = null;

/** Resolves with the Turnstile API, injecting the script once per page on first use. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    const done = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile script loaded without its API'));
    };
    script.addEventListener('load', done, { once: true });
    script.addEventListener(
      'error',
      () => {
        loading = null;
        reject(new Error('Turnstile script failed to load'));
      },
      { once: true },
    );
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

/** Test seam: forget a previous load attempt. */
export function resetTurnstileLoader(): void {
  loading = null;
}
