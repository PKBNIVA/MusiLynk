/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which site this bundle is: the public marketplace (default) or the separate admin site. */
  readonly VITE_APP_TARGET?: 'public' | 'admin';
}
