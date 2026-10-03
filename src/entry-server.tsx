/**
 * Build-time pre-render entry (`vite build --ssr src/entry-server.tsx --outDir dist-ssr`), used by
 * scripts/prerender-heads.mjs in Node, never in the browser. Renders the app for one URL with a memory
 * router and returns the HTML of #root, waiting for every lazy page chunk and Suspense boundary so the
 * markup is the first screen a visitor would see, not a loading fallback. Data still loads in the browser
 * (effects do not run here), so pages render their static frame and skeletons, exactly as the browser's
 * first render does: that is what makes hydration a no-op.
 */
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { createMemoryRouter } from 'react-router';
import App from './app/App';
import { routes } from './app/routes';

export function render(url: string, timeoutMs = 10_000): Promise<string> {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback) {
        callback();
        resolve(Buffer.concat(chunks).toString('utf8'));
      },
    });
    const timer = setTimeout(() => {
      stream.abort(new Error(`pre-render of ${url} did not settle within ${timeoutMs} ms`));
    }, timeoutMs);
    const stream = renderToPipeableStream(<App router={router} />, {
      onAllReady() {
        clearTimeout(timer);
        stream.pipe(sink);
      },
      onShellError(error) {
        clearTimeout(timer);
        reject(error);
      },
      onError(error) {
        // Reported once: a page that throws while pre-rendering must fail the build, not ship a fallback.
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    });
  });
}
