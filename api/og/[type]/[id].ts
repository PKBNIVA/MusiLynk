// Vercel Node.js function for GET /api/og/<type>/<id>[.png]: the per-share Open Graph card.
// The renderer is a STATIC import of @vercel/og (pinned to 0.11.1, the last line that runs on Node);
// a dynamic import is left unbundled and Vercel's deploy validation rejects it. Everything else lives
// in api/_lib/og.ts, which is unit-tested without the renderer.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ImageResponse } from '@vercel/og';
import { DEFAULT_API_ORIGIN, SIZE, fallbackResponse, fetchImage, fetchJson, respond } from '../../_lib/og.js';
import type { Deps } from '../../_lib/og.js';

export const config = { runtime: 'nodejs' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function render(tree: Parameters<Deps['render']>[0]): Promise<ArrayBuffer> {
  // Reading the body here (rather than returning the ImageResponse) makes a drawing error land in
  // respond()'s fallbacks instead of in a half-sent response.
  return new ImageResponse(tree as never, { ...SIZE }).arrayBuffer();
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
