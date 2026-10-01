// @vitest-environment node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIZE, fetchImage, fetchJson, respond } from '../../api/_lib/og.ts';

// The share-image renderer end to end with the real renderer (satori + resvg, as in
// api/og/[type]/[id].ts) and a real photo: a small JPEG served from a local HTTP server. The
// handler only fetches https photos, so the test maps the fixture's https address onto the local
// server; everything else (fetch, size and type checks, drawing, PNG) is the production code.

const FONT = readFileSync(new URL('../../api/_lib/fonts/Geist-Regular.ttf', import.meta.url));
const JPEG = readFileSync(new URL('./fixtures/photo.jpg', import.meta.url));
const WEBP = readFileSync(new URL('./fixtures/photo.webp', import.meta.url));
const PHOTO_HOST = 'https://photos.example.test';

let server;
let origin;
let trees;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/photo.jpg') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
    if (req.url === '/photo.webp') return res.writeHead(200, { 'Content-Type': 'image/webp' }).end(WEBP);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

async function render(tree) {
  trees.push(JSON.stringify(tree));
  const svg = await satori(tree, { ...SIZE, fonts: [{ name: 'Geist', data: FONT, weight: 400, style: 'normal' }] });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE.width } }).render().asPng();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
}

const deps = (photoPath) => ({
  apiOrigin: 'https://api.example.test',
  fetchJson: async () => ({
    professional: {
      name: 'Meera Iyer',
      headline: 'Session drummer',
      location: 'Pune',
      photoUrl: `${PHOTO_HOST}${photoPath}`,
    },
  }),
  fetchImage: (url) => fetchImage(url.replace(PHOTO_HOST, origin)),
  render,
});

const ask = (photoPath) =>
  respond(new Request('https://x.test/api/og/professional/p1.png'), 'professional', 'p1', deps(photoPath));

/** Width and height from the PNG's IHDR chunk. */
function pngSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('share image with a real photo', () => {
  it('renders a professional with an uploaded JPEG photo as a 1200x630 PNG', async () => {
    trees = [];
    const res = await ask('/photo.jpg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    expect(trees).toHaveLength(1);
    expect(trees[0]).toContain('data:image/jpeg;base64,');
  });

  it('falls back to the generated art for a WebP photo, still a 1200x630 PNG', async () => {
    trees = [];
    const res = await ask('/photo.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    expect(trees).toHaveLength(1);
    expect(trees[0]).not.toMatch(/data:image\/(jpeg|png|webp)/); // only the Verse mark (svg) is embedded
    expect(trees[0]).toContain('"MI"'); // the monogram art is drawn instead
  });

  it('serves the real JSON helper as well (fetchJson reads the local API)', async () => {
    const api = createServer((_req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'),
    );
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    try {
      expect(await fetchJson(`http://127.0.0.1:${api.address().port}/x`)).toEqual({ ok: true });
    } finally {
      await new Promise((resolve) => api.close(resolve));
    }
  });
});
