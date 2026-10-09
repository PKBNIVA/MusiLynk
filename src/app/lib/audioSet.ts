/**
 * Payload the API attaches to an uploaded audio file that has generated variants (backend
 * AudioSet): the 30 s AAC `preview` the player starts with, the `full` AAC transcode of an
 * uncompressed original (null when the original itself is the full track, e.g. an MP3), the
 * waveform `peaks` JSON and the track `duration` in seconds. Absent (null) for uploads without
 * variants, which then play from their URL.
 */
export interface AudioSet {
  preview: string | null;
  full: string | null;
  peaks: string | null;
  duration: number | null;
}

/** The peaks file AudioVariantsJob writes: 0..1 values spread over the whole track. */
export interface PeaksFile {
  version: number;
  duration: number;
  peaks: number[];
}

/** True when the payload has a preview to start from. */
export function hasPreview(audio: AudioSet | null | undefined): audio is AudioSet & { preview: string } {
  return Boolean(audio && audio.preview);
}

/** The URL that plays the whole track: the AAC transcode when there is one, else the original. */
export function fullTrackUrl(audio: AudioSet | null | undefined, original: string): string {
  return audio?.full || original;
}

/** Parses a fetched peaks file; null when it is not the shape the job writes. */
export function parsePeaks(raw: unknown): number[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const peaks = (raw as { peaks?: unknown }).peaks;
  if (!Array.isArray(peaks) || peaks.length === 0) return null;
  const values = peaks.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return values.length > 0 ? values : null;
}
