// Vercel Node.js function for GET /api/og/<type>/<id>[.png]: the per-share Open Graph card.
// Rendered with satori (SVG) + @resvg/resvg-js (PNG), both STATIC imports so Vercel bundles them.
// @vercel/og is not used: its sharp dependency fails `npm audit` (and 1.0.x does not run on Node).
// Everything else lives in api/_lib/og.ts, which is unit-tested without the renderer.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { DEFAULT_API_ORIGIN, SIZE, fallbackResponse, fetchImage, fetchJson, respond } from '../../_lib/og.js';
import type { Deps } from '../../_lib/og.js';

export const config = { runtime: 'nodejs' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Geist Regular (SIL OFL), the same face @vercel/og ships. The `new URL(..., import.meta.url)` form is
// what lets Vercel's file tracing include the font in the function bundle.
const FONT = readFileSync(new URL('../../_lib/fonts/Geist-Regular.ttf', import.meta.url));

// satori's HarfBuzz loads hb.wasm from its own directory at runtime, a read Vercel's file tracing cannot
// see. Naming the file this way (same `new URL(..., import.meta.url)` form as the font) makes the tracer
// ship it in the function bundle. Unused otherwise.
const HARFBUZZ_WASM = new URL('../../../node_modules/harfbuzzjs/hb.wasm', import.meta.url);
readFileSync(HARFBUZZ_WASM);

async function render(tree: Parameters<Deps['render']>[0]): Promise<ArrayBuffer> {
  const svg = await satori(tree as never, {
    ...SIZE,
    fonts: [{ name: 'Geist', data: FONT, weight: 400, style: 'normal' }],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE.width } }).render().asPng();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[] | undefined> },
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url || '/', `https://${req.headers.host || 'verse-music-platform.vercel.app'}`);
  const request = new Request(url, { method: 'GET' });
  let response: Response;
  try {
    const apiOrigin = (process.env.OG_API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
    response = await respond(request, first(req.query?.type), first(req.query?.id), {
      apiOrigin,
      fetchJson,
      fetchImage,
      render,
    });
  } catch {
    response = fallbackResponse();
  }
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
