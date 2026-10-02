import { useId } from 'react';
import { BRAND_NAME } from '../lib/brand';

type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

/** The MusiLynk "Signal M" tile (public/musilynk-mark.svg), inline so it needs no request and scales crisply. */
export function BrandGlyph({ size = 38 }: { size?: number }) {
  const gradient = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      data-testid="brand-glyph"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset=".5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="23" fill={`url(#${gradient})`} />
      <g transform="translate(50 50) scale(0.86) translate(-50 -50)">
        <path
          d="M15 72H22C28 72 30 22 36.5 22C43 22 44.5 58 50 58C55.5 58 57 31 63.5 31C70 31 72 72 78 72H85"
          fill="none"
          stroke="#fff"
          strokeWidth="10.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="15" cy="72" r="9" fill="#f0abfc" />
        <circle cx="85" cy="72" r="9" fill="#f0abfc" />
      </g>
    </svg>
  );
}

export function BrandMark({ compact = false, inverse = true }: BrandMarkProps) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <BrandGlyph />
      <span className="leading-none">
        <span className={`block text-lg font-black tracking-[-0.03em] ${inverse ? 'text-white' : 'text-slate-950'}`}>
          {BRAND_NAME}
        </span>
        {!compact && (
          <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
            music works here
          </span>
        )}
      </span>
    </span>
  );
}
