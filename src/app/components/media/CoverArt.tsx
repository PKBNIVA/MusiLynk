import { useId } from 'react';
import { FormatGlyph } from '../kit/FormatGlyph';
import { blobs, gradientAngle, paletteFor, ribbonBars } from '../../lib/coverArt';

type Props = {
  /** Anything stable and unique to the entity (its id): the same seed always draws the same picture. */
  seed: string;
  /** opportunity_kind for jobs; picks the glyph and, with no genre match, the palette. */
  kind?: string | null;
  genres?: readonly string[];
  /** Pixels (crisp from 48 to 640) or `fill` to cover a sized parent. */
  size: number | 'fill';
  /** `true` for rounded corners, `'full'` for a circle. */
  rounded?: boolean | 'full';
  /** Number of waveform bars; ArtAvatar uses fewer. */
  bars?: number;
  /** Screen-reader name. Leave out when the entity is named right beside it (the usual case). */
  label?: string;
  className?: string;
};

const BAND = { top: 46, height: 28 };

/**
 * Deterministic generated art: a gradient field, three soft blobs, a waveform ribbon and (for
 * jobs) the kind's glyph. It is decoration, never a photograph, so it can stand in for a demo
 * profile without pretending to be a person.
 */
export function CoverArt({ seed, kind, genres = [], size, rounded = false, bars = 48, label, className = '' }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const palette = paletteFor(seed, kind, genres);
  const angle = gradientAngle(seed);
  const rad = (angle * Math.PI) / 180;
  const x1 = 50 - Math.cos(rad) * 50;
  const y1 = 50 - Math.sin(rad) * 50;
  const x2 = 50 + Math.cos(rad) * 50;
  const y2 = 50 + Math.sin(rad) * 50;
  const glows = blobs(seed);
  const heights = ribbonBars(seed, bars);
  const step = 84 / bars;
  const px = size === 'fill' ? '100%' : size;
  const radius =
    rounded === 'full'
      ? '9999px'
      : rounded
        ? `${Math.max(8, Math.round((size === 'fill' ? 240 : size) * 0.08))}px`
        : undefined;
  const glyphSize = size !== 'fill' && size < 96 ? null : size !== 'fill' && size < 200 ? 20 : 24;
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <span
      {...a11y}
      data-testid="cover-art"
      data-palette={palette.name}
      className={`relative inline-block shrink-0 overflow-hidden align-middle ${className}`}
      style={{ width: px, height: px, borderRadius: radius }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" className="block">
        <defs>
          <linearGradient id={`${uid}g`} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}>
            <stop offset="0" stopColor={palette.from} />
            <stop offset="1" stopColor={palette.to} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${uid}g)`} />
      </svg>
      {/* The glows are fitted inside the shorter side (meet), not stretched to cover the longer one,
          so in a wide card they stay soft circles instead of growing into one huge disc. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        className="absolute inset-0 block"
        data-testid="cover-art-glows"
      >
        <defs>
          {glows.map((b, i) => (
            <radialGradient key={i} id={`${uid}b${i}`}>
              <stop offset="0" stopColor={i === 0 ? palette.accent : '#ffffff'} stopOpacity={b.opacity} />
              <stop offset="0.55" stopColor={i === 0 ? palette.accent : '#ffffff'} stopOpacity={b.opacity * 0.35} />
              <stop offset="1" stopColor={i === 0 ? palette.accent : '#ffffff'} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {glows.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={`url(#${uid}b${i})`} />
        ))}
      </svg>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
        className="absolute inset-0 block"
      >
        <g fill="#ffffff" fillOpacity="0.55">
          {heights.map((h, i) => {
            const barHeight = Math.max(2, h * BAND.height);
            return (
              <rect
                key={i}
                x={8 + i * step + step * 0.15}
                y={BAND.top + (BAND.height - barHeight) / 2}
                width={step * 0.7}
                height={barHeight}
                rx={Math.min(1.2, step * 0.35)}
              />
            );
          })}
        </g>
      </svg>
      {kind && glyphSize && (
        <span className="pointer-events-none absolute left-3 top-3 grid size-9 place-items-center rounded-full bg-black/30">
          <FormatGlyph kind={kind} size={glyphSize as 20 | 24} className="text-white!" />
        </span>
      )}
    </span>
  );
}
