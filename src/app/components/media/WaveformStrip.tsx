import { normalizePeaks } from '../../lib/coverArt';

type Props = {
  /** Up to any length; resampled to exactly 64 bars. */
  peaks: number[];
  /** Highlights the whole strip while a sample plays. */
  playing?: boolean;
  /** 0-1: bars up to this point are drawn bright, the rest dim. */
  progress?: number;
  height?: number;
  className?: string;
};

const BARS = 64;

/** 64 bars from a sample's waveform peaks. Decorative: the sample title is always written nearby. */
export function WaveformStrip({ peaks, playing = false, progress, height = 24, className = '' }: Props) {
  const bars = normalizePeaks(peaks, BARS) ?? [];
  const played = typeof progress === 'number' ? Math.round(Math.min(1, Math.max(0, progress)) * BARS) : null;
  return (
    <svg
      aria-hidden="true"
      data-testid="waveform-strip"
      data-playing={playing ? 'true' : undefined}
      viewBox={`0 0 ${BARS * 3} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={className}
    >
      {bars.map((peak, i) => {
        const h = Math.max(2, peak * height);
        const lit = played === null ? playing : i < played;
        return (
          <rect
            key={i}
            x={i * 3}
            y={(height - h) / 2}
            width="2"
            height={h}
            rx="1"
            className={lit ? 'fill-violet-300' : 'fill-slate-500'}
          />
        );
      })}
    </svg>
  );
}
