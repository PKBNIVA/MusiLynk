import type { ReactNode } from 'react';

export type SceneName =
  'inbox' | 'stage' | 'search' | 'calendar' | 'applicants' | 'portfolio' | 'bookmark' | 'verified';

const L = 'stroke-violet-300/70';
const A = 'fill-fuchsia-500/20';

/** Eight 160x120 line illustrations: violet strokes, one fuchsia accent shape each, no text. */
export const SCENES: Record<SceneName, ReactNode> = {
  inbox: (
    <>
      <path className={A} d="M30 62h100l-14-26H44z" />
      <path className={L} d="M30 62l14-26h72l14 26v36a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4z" />
      <path className={L} d="M30 62h32l6 10h24l6-10h32" />
    </>
  ),
  stage: (
    <>
      <path className={A} d="M80 14 52 100h56z" />
      <rect className={L} x="72" y="34" width="16" height="28" rx="8" />
      <path className={L} d="M66 52a14 14 0 0 0 28 0M80 66v34M64 104h32" />
    </>
  ),
  search: (
    <>
      <rect className={A} x="24" y="28" width="78" height="60" rx="6" />
      <rect className={L} x="24" y="28" width="78" height="60" rx="6" />
      <path className={L} d="M36 46h40M36 58h28" />
      <circle className={L} cx="98" cy="72" r="18" />
      <path className={L} d="m111 85 18 18" />
    </>
  ),
  calendar: (
    <>
      <rect className={A} x="30" y="26" width="100" height="18" rx="4" />
      <rect className={L} x="30" y="26" width="100" height="72" rx="8" />
      <path className={L} d="M30 44h100M54 18v14M106 18v14M68 70l10 10 18-20" />
    </>
  ),
  applicants: (
    <>
      <circle className={A} cx="80" cy="42" r="14" />
      <circle className={L} cx="80" cy="42" r="14" />
      <circle className={L} cx="42" cy="72" r="12" />
      <circle className={L} cx="118" cy="72" r="12" />
      <path
        className={L}
        d="M22 104c2-12 10-18 20-18s18 6 20 18M98 104c2-12 10-18 20-18s18 6 20 18M60 88c2-10 10-16 20-16s18 6 20 16"
      />
    </>
  ),
  portfolio: (
    <>
      <rect className={L} x="34" y="24" width="82" height="52" rx="6" />
      <rect className={L} x="44" y="36" width="82" height="52" rx="6" />
      <rect className={A} x="54" y="48" width="82" height="52" rx="6" />
      <rect className={L} x="54" y="48" width="82" height="52" rx="6" />
      <path className={L} d="m88 64 16 10-16 10z" />
    </>
  ),
  bookmark: (
    <>
      <path className={A} d="M52 20h56v84l-28-20-28 20z" />
      <path className={L} d="M52 20h56v84l-28-20-28 20z" />
      <path className={L} d="m80 40 5 10 11 1-8 8 2 11-10-6-10 6 2-11-8-8 11-1z" />
    </>
  ),
  verified: (
    <>
      <path className={A} d="M80 14 40 30v30c0 24 16 40 40 48 24-8 40-24 40-48V30z" />
      <path className={L} d="M80 14 40 30v30c0 24 16 40 40 48 24-8 40-24 40-48V30z" />
      <path className={L} d="m62 62 14 14 24-28" />
    </>
  ),
};

export function Scene({ name, className = '' }: { name: SceneName; className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      width="160"
      height="120"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-scene={name}
      className={className}
    >
      {SCENES[name]}
    </svg>
  );
}
