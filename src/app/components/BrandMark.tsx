import { BRAND_NAME } from '../lib/brand';
import {
  BRAND_MARK_ASPECT,
  BRAND_MARK_EVENODD,
  BRAND_MARK_ON_DARK,
  BRAND_MARK_ON_LIGHT,
  BRAND_MARK_PATHS,
  BRAND_MARK_VIEWBOX,
} from '../lib/brandMark.generated';

type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

/**
 * The MusiLynk symbol, drawn inline from brandMark.generated.ts (built from brand/logo/ by
 * `npm run brand:build`), so it needs no request and scales crisply. `size` is its height in px.
 */
export function BrandGlyph({ size = 30, inverse = true }: { size?: number; inverse?: boolean }) {
  return (
    <svg
      width={Math.round(size * BRAND_MARK_ASPECT)}
      height={size}
      viewBox={BRAND_MARK_VIEWBOX}
      fill={inverse ? BRAND_MARK_ON_DARK : BRAND_MARK_ON_LIGHT}
      fillRule={BRAND_MARK_EVENODD ? 'evenodd' : undefined}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      data-testid="brand-glyph"
    >
      {BRAND_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function BrandMark({ compact = false, inverse = true }: BrandMarkProps) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <BrandGlyph size={compact ? 24 : 30} inverse={inverse} />
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
