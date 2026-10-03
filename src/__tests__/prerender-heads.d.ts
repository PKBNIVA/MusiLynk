// The build script is plain Node; only what the tests use is typed here.
declare module '*/scripts/prerender-heads.mjs' {
  export const PRERENDERED_PATHS: string[];
  export const PRERENDERED_SHELLS: Record<string, string>;
  export function render(
    indexHtml: string,
    path: string,
    meta: [string, string],
    jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>,
  ): string;
}
