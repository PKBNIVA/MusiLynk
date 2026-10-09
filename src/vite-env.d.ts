/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which site this bundle is: the public marketplace (default) or the separate admin site. */
  readonly VITE_APP_TARGET?: 'public' | 'admin';
  /** Cloudflare Turnstile site key (docs/ops/turnstile.md). Unset: no widget, no token sent. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
