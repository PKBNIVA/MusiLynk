// GET /api/og/<type>/<id>.png: the per-share Open Graph card (see api/og/_card.ts for what it draws).
// A Node.js serverless function. @vercel/og is imported statically and is a regular dependency, so the
// deploy bundles it; a bare dynamic import of it was what Vercel rejected on the old edge version
// ("referencing unsupported modules: @vercel"). If drawing fails altogether the visitor is sent to the
// static default card instead of getting an error.
import { ImageResponse } from '@vercel/og';
import { handle, SIZE, staticFallback } from '../_card.js';

// Reading the body here (rather than returning the ImageResponse) makes a drawing error land in the
// fallbacks of respond() instead of in a half-sent response.
const render = (tree: unknown): Promise<ArrayBuffer> => new ImageResponse(tree as never, { ...SIZE }).arrayBuffer();

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request, render);
  } catch {
    return staticFallback(request);
  }
}
