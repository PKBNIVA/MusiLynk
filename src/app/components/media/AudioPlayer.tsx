import { useEffect, useRef, useState } from 'react';
import { fullTrackUrl, hasPreview, type AudioSet } from '../../lib/audioSet';
import { WaveformCanvas } from './WaveformCanvas';

type Props = {
  /** The original upload (or external file) URL: the full track when there is no transcode. */
  src: string;
  /** The API's audio payload (null before the variants exist, or for links). */
  audio?: AudioSet | null;
  title: string;
  /** The client-supplied waveform image, shown when there is no peaks file. */
  waveformUrl?: string | null;
  onError?: () => void;
};

/**
 * An uploaded audio sample. With variants it plays the 30 s preview clip at once (about 240 KB
 * instead of the original's megabytes), draws the waveform from the peaks file, and switches to the
 * full track (the AAC transcode, else the original) when the listener asks for it or when the
 * preview runs out while playing, keeping the position. Without variants it is the plain
 * `<audio controls>` on the original, as before. Range requests are the browser's own either way.
 */
export function AudioPlayer({ src, audio, title, waveformUrl, onError }: Props) {
  const preview = hasPreview(audio) ? audio.preview : null;
  const full = fullTrackUrl(audio, src);
  const [mode, setMode] = useState<'preview' | 'full'>(preview ? 'preview' : 'full');
  const [progress, setProgress] = useState(0);
  const ref = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<{ time: number; play: boolean } | null>(null);

  useEffect(() => {
    setMode(preview ? 'preview' : 'full');
    setProgress(0);
  }, [src, preview]);

  const current = mode === 'preview' && preview ? preview : full;
  const duration = audio?.duration || null;
  const previewOnly = Boolean(preview) && current !== full;

  // After the source swap, resume at the position the listener was at.
  useEffect(() => {
    const el = ref.current;
    const pending = pendingSeek.current;
    if (!el || !pending) return;
    pendingSeek.current = null;
    const apply = () => {
      el.currentTime = pending.time;
      if (pending.play) void el.play().catch(() => undefined);
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
  }, [current]);

  const switchToFull = (time: number, play: boolean) => {
    if (!previewOnly) return;
    pendingSeek.current = { time, play };
    setMode('full');
  };

  const total = () => {
    const el = ref.current;
    if (previewOnly && duration) return duration;
    return el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration || 0;
  };

  return (
    <div className="p-4" data-testid="audio-player" data-audio-mode={preview ? mode : 'original'}>
      {audio?.peaks ? (
        <WaveformCanvas
          peaksUrl={audio.peaks}
          progress={progress}
          className="mb-3 rounded-lg"
          onSeek={(fraction) => {
            const el = ref.current;
            const length = total();
            if (!el || !length) return;
            const time = fraction * length;
            if (previewOnly && Number.isFinite(el.duration) && time > el.duration) switchToFull(time, !el.paused);
            else el.currentTime = time;
          }}
        />
      ) : (
        waveformUrl && (
          <img src={waveformUrl} alt="Audio waveform" className="w-full h-20 object-cover opacity-70 rounded-lg mb-3" />
        )
      )}
      <audio
        ref={ref}
        controls
        preload="metadata"
        className="w-full"
        src={current}
        onError={onError}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          const length = total();
          setProgress(length > 0 ? Math.min(1, el.currentTime / length) : 0);
        }}
        onEnded={(event) => {
          // The preview ran out of a longer track: carry on with the rest of it.
          const el = event.currentTarget;
          if (previewOnly && duration && el.duration < duration - 0.5) switchToFull(el.duration, true);
        }}
        aria-label={title}
      />
      {previewOnly && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>Preview{duration ? ` of ${formatDuration(duration)}` : ''}</span>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-violet-300 hover:bg-white/5 hover:text-white"
            onClick={() => switchToFull(ref.current?.currentTime ?? 0, Boolean(ref.current && !ref.current.paused))}
          >
            Play full track
          </button>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number) {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
