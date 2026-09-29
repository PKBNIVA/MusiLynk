import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardFilename, downloadCardPng, rasteriseCard } from '../shareCard';

const toBlob = vi.fn((cb: BlobCallback, type?: string) => cb(new Blob(['png'], { type })));
const drawImage = vi.fn();
let canvas: { width: number; height: number; getContext: () => unknown; toBlob: typeof toBlob };

beforeEach(() => {
  canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? canvas : realCreate(tag)) as typeof document.createElement);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>' }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
});
afterEach(() => vi.clearAllMocks());

describe('share card rasterising', () => {
  it('draws the story card at 1080x1920 and encodes image/png', async () => {
    const blob = await rasteriseCard('/c.svg', 'story');
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 1920);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(blob.type).toBe('image/png');
  });

  it('uses 1200x630 for the landscape card', async () => {
    await rasteriseCard('/c.svg', 'landscape');
    expect([canvas.width, canvas.height]).toEqual([1200, 630]);
  });

  it('downloads as verse-verified-<slug>.png', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let name = '';
    click.mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    await expect(downloadCardPng('/c.svg', 'story', 'user_1')).resolves.toBe('downloaded');
    expect(name).toBe('verse-verified-user_1.png');
    expect(cardFilename('a b/c')).toBe('verse-verified-a-b-c.png');
  });

  it('opens the PNG in a new tab on iOS', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(downloadCardPng('/c.svg', 'story', 'user_1')).resolves.toBe('opened');
    expect(open).toHaveBeenCalledWith('blob:x', '_blank');
  });

  it('fails when the card cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(rasteriseCard('/c.svg', 'story')).rejects.toThrow();
  });
});
