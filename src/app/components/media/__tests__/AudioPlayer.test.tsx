import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const show = (el: ReactElement) => act(() => root.render(<MemoryRouter>{el}</MemoryRouter>));
const flush = () => act(async () => {});

import { AudioPlayer } from '../AudioPlayer';
import { WorkSamplePlayer } from '../../WorkSamplePlayer';
import { fullTrackUrl, hasPreview, parsePeaks, type AudioSet } from '../../../lib/audioSet';

const original = 'https://media.example.test/uploads/u/k/take.wav';
const set: AudioSet = {
  preview: `${original}/v/preview.m4a`,
  full: `${original}/v/full.m4a`,
  peaks: `${original}/v/peaks.json`,
  duration: 185.2,
};
const peaks = Array.from({ length: 400 }, (_, i) => Math.round((0.2 + 0.8 * Math.abs(Math.sin(i / 7))) * 1000) / 1000);

function mockPeaksFetch() {
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, json: async () => ({ version: 1, duration: 185.2, peaks }) } as Response;
    }),
  );
  return fetched;
}

function mockCanvas() {
  const calls: { fillStyle: string; rects: number }[] = [];
  const context = {
    fillStyle: '',
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(function (this: { fillStyle: string }) {
      const last = calls[calls.length - 1];
      if (last && last.fillStyle === this.fillStyle) last.rects += 1;
      else calls.push({ fillStyle: this.fillStyle, rects: 1 });
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return calls;
}

describe('AudioPlayer', () => {
  it('starts on the preview clip, draws the waveform from the peaks file and switches to the full track on demand', async () => {
    const fetched = mockPeaksFetch();
    const drawn = mockCanvas();
    show(<AudioPlayer src={original} audio={set} title="Take one" />);
    const audio = host.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe(set.preview);
    expect(audio.getAttribute('preload')).toBe('metadata');
    expect(audio.hasAttribute('controls')).toBe(true);
    expect(host.querySelector('[data-testid=audio-player]')?.getAttribute('data-audio-mode')).toBe('preview');
    expect(host.textContent).toContain('Preview of 3:05');

    await flush();
    expect(fetched).toEqual([set.peaks]);
    const canvas = host.querySelector('[data-testid=waveform-canvas]') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('data-bars')).toBe('200');
    expect(canvas.getAttribute('role')).toBe('slider');
    expect(drawn.reduce((sum, c) => sum + c.rects, 0)).toBe(200);

    act(() => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    expect(audio.getAttribute('src')).toBe(set.full);
    expect(host.querySelector('[data-testid=audio-player]')?.getAttribute('data-audio-mode')).toBe('full');
    expect(host.querySelector('button')).toBeNull();
  });

  it('plays the original when the upload has no variants, and the original as the full track when there is no transcode', () => {
    show(<AudioPlayer src={original} audio={null} title="Old take" waveformUrl="https://cdn.example.test/wave.png" />);
    const audio = host.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe(original);
    expect(host.querySelector('[data-testid=audio-player]')?.getAttribute('data-audio-mode')).toBe('original');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/wave.png');
    expect(host.querySelector('button')).toBeNull();

    mockPeaksFetch();
    const mp3 = 'https://media.example.test/uploads/u/k/take.mp3';
    show(<AudioPlayer src={mp3} audio={{ ...set, full: null }} title="MP3 take" />);
    act(() => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    expect(host.querySelector('audio')?.getAttribute('src')).toBe(mp3);
  });

  it('is what WorkSamplePlayer renders for an uploaded audio sample', async () => {
    mockPeaksFetch();
    mockCanvas();
    show(
      <WorkSamplePlayer
        sample={{
          title: 'Live take',
          url: original,
          type: 'audio',
          audio: set,
          mediaMetadata: { contentType: 'audio/wav' },
        }}
      />,
    );
    await flush();
    expect(host.querySelector('[data-media-kind=audio]')).not.toBeNull();
    expect(host.querySelector('audio')?.getAttribute('src')).toBe(set.preview);
    expect(host.querySelector('[data-testid=waveform-canvas]')).not.toBeNull();
  });

  it('exposes the payload helpers', () => {
    expect(hasPreview(set)).toBe(true);
    expect(hasPreview({ ...set, preview: null })).toBe(false);
    expect(hasPreview(null)).toBe(false);
    expect(fullTrackUrl(set, original)).toBe(set.full);
    expect(fullTrackUrl({ ...set, full: null }, original)).toBe(original);
    expect(fullTrackUrl(undefined, original)).toBe(original);
    expect(parsePeaks({ version: 1, duration: 2, peaks: [0.1, 'x', 0.5] })).toEqual([0.1, 0.5]);
    expect(parsePeaks({ peaks: [] })).toBeNull();
    expect(parsePeaks('nope')).toBeNull();
  });
});
