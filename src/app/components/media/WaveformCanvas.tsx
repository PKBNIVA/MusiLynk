import { useEffect, useRef, useState } from 'react';
import { normalizePeaks } from '../../lib/coverArt';
import { parsePeaks } from '../../lib/audioSet';

type Props = {
  /** The peaks JSON AudioVariantsJob wrote (`<key>/v/peaks.json`). */
  peaksUrl: string;
  /** 0-1: the played part is drawn bright, the rest dim. */
  progress: number;
  /** Called with 0-1 when the listener clicks or taps a point of the waveform. */
  onSeek?: (fraction: number) => void;
  height?: number;
  className?: string;
};

const BARS = 200;
const DIM = 'rgba(148, 163, 184, 0.55)'; // slate-400
const LIT = 'rgb(196, 181, 253)'; // violet-300

/**
 * The waveform of an uploaded sample, drawn on a canvas from the 400-point peaks file (resampled
 * to 200 bars, so a phone-width strip stays crisp without a runtime dependency). Decorative until
 * `onSeek` is given, then a slider the listener can click. Nothing is drawn (and nothing is fetched
 * twice) when the peaks file cannot be read.
 */
export function WaveformCanvas({ peaksUrl, progress, onSeek, height = 56, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bars, setBars] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBars(null);
    fetch(peaksUrl, { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        const peaks = parsePeaks(json);
        setBars(peaks ? normalizePeaks(peaks, BARS) : null);
      })
      .catch(() => {
        if (!cancelled) setBars(null);
      });
    return () => {
      cancelled = true;
    };
  }, [peaksUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bars) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const width = canvas.clientWidth || 320;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const slot = width / bars.length;
    const barWidth = Math.max(1, slot * 0.6);
    const lit = Math.round(Math.min(1, Math.max(0, progress)) * bars.length);
    bars.forEach((peak, i) => {
      const h = Math.max(2, peak * (height - 4));
      context.fillStyle = i < lit ? LIT : DIM;
      context.fillRect(i * slot + (slot - barWidth) / 2, (height - h) / 2, barWidth, h);
    });
  }, [bars, progress, height]);

  if (!bars) return null;
  const seek = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSeek) return;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };
  return (
    <canvas
      ref={canvasRef}
      data-testid="waveform-canvas"
      data-bars={bars.length}
      role={onSeek ? 'slider' : undefined}
      aria-label={onSeek ? 'Seek' : undefined}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onClick={(event) => seek(event.clientX)}
      onKeyDown={(event) => {
        if (!onSeek) return;
        if (event.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
        else if (event.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
      }}
      style={{ height }}
      className={`block w-full ${onSeek ? 'cursor-pointer' : ''} ${className}`}
    />
  );
}
