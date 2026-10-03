// Builds every logo asset from the sources in brand/logo/ (see brand/logo/README.md):
//
//   brand/logo/mark.svg          the symbol, 100x100 grid, <path> elements filled with currentColor
//   brand/logo/mark-small.svg    optional heavier cut for 16-32 px (favicon); mark.svg is used if absent
//   brand/logo/wordmark.svg      "MusiLynk", outlined (cap height 100, baseline y=0)
//   brand/logo/logo.config.json  colours, tile gradient, corner radius, padding ratios, OG copy
//
// Usage: npm run brand:build            (all assets; PNG/ICO need @resvg/resvg-js, see below)
//        npm run brand:build -- --check (fail if a committed vector/TS output is out of date)
//
// Vector outputs (SVGs, the TS module, manifest colours) need nothing but Node. The PNG and ICO
// outputs are rendered with @resvg/resvg-js, which is not a dependency of this repo: install it
// once with `npm i -D @resvg/resvg-js` before running the build (do not commit that change unless
// you mean to), or the raster step stops with that message and writes nothing raster.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => resolve(root, 'brand/logo', p);
const out = (p) => resolve(root, p);
const check = process.argv.includes('--check');
const stale = [];

const config = JSON.parse(readFileSync(src('logo.config.json'), 'utf8'));
const { colors, tile: T, padding: PAD, lockup: LK, og: OG } = config;
const [bx1, by1, bx2, by2] = config.markInkBox;
const inkW = bx2 - bx1;
const inkH = by2 - by1;

// ---- sources ----------------------------------------------------------------------------------
/** Reads an SVG source: its viewBox and inner markup (comments and the <svg> wrapper removed). */
function readSvg(file) {
  const text = readFileSync(src(file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const open = text.match(/<svg\b[^>]*>/);
  if (!open) throw new Error(`${file}: no <svg> element`);
  const viewBox = (open[0].match(/viewBox="([^"]+)"/) ?? [])[1];
  if (!viewBox) throw new Error(`${file}: the <svg> needs a viewBox`);
  const inner = text.slice(text.indexOf(open[0]) + open[0].length, text.lastIndexOf('</svg>')).trim();
  return {
    viewBox: viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number),
    inner,
  };
}

/** The mark's <path> data. The app draws the mark from these, so only plain filled paths are allowed. */
function markPaths(file, inner) {
  const rest = inner
    .replace(/<path\b[^>]*\/>/g, '')
    .replace(/<\/?g\b[^>]*>/g, '')
    .trim();
  if (rest) {
    throw new Error(
      `${file}: only <path> elements are supported (found "${rest.slice(0, 60)}"). ` +
        'Convert shapes, strokes, masks and clips to filled outlines first (see brand/logo/README.md).',
    );
  }
  return [...inner.matchAll(/<path\b([^>]*)\/>/g)].map(([, attrs]) => {
    const d = (attrs.match(/\sd="([^"]+)"/) ?? [])[1];
    if (!d) throw new Error(`${file}: a <path> without d`);
    if (/\b(stroke|mask|clip-path|transform)=/.test(attrs)) throw new Error(`${file}: paths must be plain fills`);
    const evenOdd = /fill-rule="evenodd"/.test(attrs);
    return { d: d.replace(/\s+/g, ' ').trim(), evenOdd };
  });
}

const mark = readSvg('mark.svg');
if (mark.viewBox.join(' ') !== '0 0 100 100') throw new Error('mark.svg: the viewBox must be "0 0 100 100"');
const paths = markPaths('mark.svg', mark.inner);
const small = existsSync(src('mark-small.svg')) ? readSvg('mark-small.svg') : mark;
const smallPaths = markPaths('mark-small.svg', small.inner);
const wordmark = readSvg('wordmark.svg');
const wmPaths = [...wordmark.inner.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
const wmWidth = wordmark.viewBox[2] + wordmark.viewBox[0];

// ---- drawing helpers (all return SVG markup) ---------------------------------------------------
const fmt = (n) => String(+n.toFixed(3));
const pathEls = (list, fill) =>
  list.map((p) => `<path${p.evenOdd ? ' fill-rule="evenodd"' : ''} fill="${fill}" d="${p.d}"/>`).join('');
/** The mark (ink box) drawn `h` units tall with its top-left ink corner at (x, y). Returns { svg, w }. */
function glyph(x, y, h, fill, { cut = paths } = {}) {
  const s = h / inkH;
  return {
    svg: `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(s)}) translate(${-bx1} ${-by1})">${pathEls(cut, fill)}</g>`,
    w: inkW * s,
  };
}
/** The app-icon tile: gradient square (rounded unless full-bleed) with the white mark centred. */
function tile(size, { glyphW = PAD.tile, radius = T.cornerRadius, full = false, cut = paths, id = 'tg' } = {}) {
  const gw = size * glyphW;
  const gh = (gw * inkH) / inkW;
  const r = full ? 0 : size * radius;
  const g = glyph((size - gw) / 2, (size - gh) / 2, gh, T.glyph, { cut });
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.gradientFrom}"/>` +
    `<stop offset="1" stop-color="${T.gradientTo}"/></linearGradient></defs>` +
    `<rect width="${size}" height="${size}"${r ? ` rx="${fmt(r)}"` : ''} fill="url(#${id})"/>${g.svg}`
  );
}
/** The wordmark with cap height `cap`, baseline at y = `base`, ink starting at x. */
const word = (x, base, cap, fill) =>
  `<g transform="translate(${fmt(x)} ${fmt(base)}) scale(${fmt(cap / 100)})">${wmPaths.map((d) => `<path fill="${fill}" d="${d}"/>`).join('')}</g>`;
/** Horizontal lockup: mark `h` tall at (x, y), wordmark set to the config's ratios. Returns { svg, w }. */
function lockup(x, y, h, markFill, textFill) {
  const g = glyph(x, y, h, markFill);
  const cap = h * LK.capHeight;
  const wx = x + g.w + h * LK.gap;
  return { svg: g.svg + word(wx, y + h / 2 + cap / 2, cap, textFill), w: g.w + h * LK.gap + (wmWidth * cap) / 100 };
}
const svgDoc = (w, h, inner, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}"${attrs}>${inner}</svg>\n`;
const titled = (inner) => `<title>${config.name}</title>${inner}`;
const img = ` role="img" aria-label="${config.name}"`;

// ---- writing ------------------------------------------------------------------------------------
function emit(path, data) {
  const file = out(path);
  if (check) {
    const now = existsSync(file) ? readFileSync(file) : null;
    if (!now || !now.equals(Buffer.from(data))) stale.push(path);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('  wrote', path);
}

// ---- vector outputs -----------------------------------------------------------------------------
const tileSvg = svgDoc(100, 100, titled(tile(100, { id: 'mlk-tile' })), img);
const faviconSvg = svgDoc(
  100,
  100,
  tile(100, { glyphW: PAD.smallTile, radius: T.smallCornerRadius, cut: smallPaths, id: 'mlk-fav' }),
);
emit('public/favicon.svg', faviconSvg);
emit('public/musilynk-mark.svg', tileSvg);

// The rest of the kit (not served by the site): lockups, one-colour marks, the WhatsApp avatar,
// email header images. Files the site serves go to public/ only.
const kit = 'brand/logo/kit';
const bare = (fill) => svgDoc(100, 100, titled(glyph(bx1, by1, inkH, fill).svg), img);
emit(`${kit}/musilynk-mark-mono.svg`, bare('currentColor'));
emit(`${kit}/musilynk-glyph-light-bg.svg`, bare(config.mark.onLight));
emit(`${kit}/musilynk-glyph-dark-bg.svg`, bare(config.mark.onDark));
for (const [theme, m, t] of [
  ['dark', config.mark.onDark, colors.white],
  ['light', config.mark.onLight, colors.ink],
  ['mono-dark', colors.white, colors.white],
  ['mono-light', colors.ink, colors.ink],
]) {
  // 100 units tall: the mark is 68 tall with 16 clear above and below, like the 100 grid.
  const l = lockup(0, 16, 68, m, t);
  emit(`${kit}/musilynk-logo-horizontal-${theme}.svg`, svgDoc(Math.ceil(l.w), 100, titled(l.svg), img));
}
const wmDoc = (fill) =>
  svgDoc(
    wordmark.viewBox[2],
    wordmark.viewBox[3],
    titled(`<g transform="translate(0 ${-wordmark.viewBox[1]})">${word(0, 0, 100, fill)}</g>`),
    img,
  );
emit(`${kit}/musilynk-wordmark.svg`, wmDoc('currentColor'));
emit(`${kit}/musilynk-wordmark-color-light-bg.svg`, wmDoc(colors.ink));
emit(
  `${kit}/email-brand-header.html`,
  `<!-- ${config.name} email brand header (the live one is EmailDelivery.brand_header_html). The 64 px mark is shown
     at 32 px; if images are blocked, the img's own background paints the tile colour with an "M". -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td style="width:32px;height:32px;padding:0;vertical-align:middle"><img src="https://ASSET_HOST/email-mark-64.png" width="32" height="32" alt="M" style="display:block;width:32px;height:32px;border:0;border-radius:8px;background:${T.flat};color:#ffffff;font:800 18px/32px Arial,Helvetica,sans-serif;text-align:center"></td>
<td style="padding:0 0 0 10px;vertical-align:middle;font:800 22px/32px Arial,Helvetica,sans-serif;letter-spacing:-0.3px;color:#ffffff">${config.name}</td>
</tr></table>
`,
);

// Manifest and the HTML theme colour follow the config.
{
  const manifest = JSON.parse(readFileSync(out('public/manifest.webmanifest'), 'utf8'));
  manifest.theme_color = colors.night;
  manifest.background_color = colors.night;
  emit('public/manifest.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`);
  const html = readFileSync(out('index.html'), 'utf8');
  emit('index.html', html.replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${colors.night}$2`));
}

// Backend: the email header's fallback tile colour (backend/config/initializers/brand.rb reads it).
emit(
  'backend/config/brand_logo.json',
  `${JSON.stringify({ generatedBy: 'npm run brand:build', tileColor: T.flat, name: config.name }, null, 2)}\n`,
);

// The TS module the app (BrandMark) and the OG function read. Each value is its own export so the
// app bundles only what it uses, and the mark's path is rewritten compactly (relative commands,
// coordinates rounded to 0.1 of the 100 grid, invisible at UI sizes) to keep the entry chunk small.
/** Rewrites path data with relative commands and coordinates rounded to tenths (no drift). */
function compactPath(d) {
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? [];
  const t10 = (v) => Math.round(v * 10);
  const num = (n) => {
    const v = (n / 10).toFixed(1).replace(/\.0$/, '');
    return v.replace(/^(-?)0\./, '$1.');
  };
  let i = 0;
  let cmd = '';
  let [cx, cy, sx, sy] = [0, 0, 0, 0]; // current point and subpath start, in tenths
  let outD = '';
  let last = '';
  let prev = null; // the previous number written, for separators
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const up = cmd.toUpperCase();
    if (!(up in ARGS)) throw new Error(`mark path: unsupported command ${cmd}`);
    const rel = cmd !== up;
    const args = tokens.slice(i, i + ARGS[up]).map(Number);
    i += ARGS[up];
    let vals;
    if (up === 'Z') {
      vals = [];
      [cx, cy] = [sx, sy];
    } else if (up === 'H' || up === 'V') {
      const abs = t10(rel ? (up === 'H' ? cx : cy) / 10 + args[0] : args[0]);
      vals = [abs - (up === 'H' ? cx : cy)];
      if (up === 'H') cx = abs;
      else cy = abs;
    } else {
      const pts =
        up === 'A' ? [args.slice(5)] : Array.from({ length: args.length / 2 }, (_, k) => args.slice(k * 2, k * 2 + 2));
      const abs = pts.map(([x, y]) => [t10(rel ? cx / 10 + x : x), t10(rel ? cy / 10 + y : y)]);
      const relPts = abs.flatMap(([x, y]) => [x - cx, y - cy]);
      vals = up === 'A' ? [...args.slice(0, 5).map((v) => v * 10), ...relPts] : relPts;
      [cx, cy] = abs.at(-1);
      if (up === 'M') [sx, sy] = [cx, cy];
    }
    let letter = up.toLowerCase();
    if (letter === 'l' && vals[0] === 0) [letter, vals] = ['v', [vals[1]]];
    else if (letter === 'l' && vals[1] === 0) [letter, vals] = ['h', [vals[0]]];
    if (letter !== last || letter === 'm' || letter === 'z') {
      outD += letter;
      prev = null;
    }
    for (const v of vals.map(num)) {
      if (prev !== null && !v.startsWith('-') && !(v.startsWith('.') && prev.includes('.'))) outD += ' ';
      outD += v;
      prev = v;
    }
    last = letter === 'm' ? 'l' : letter; // a moveto's extra pairs are linetos
  }
  return outD;
}
{
  const lines = [
    '// Generated by scripts/brand/build-logo.mjs from brand/logo/. Do not edit: change the sources and run',
    '// `npm run brand:build`.',
    '',
    `/** The ${config.name} mark ("${config.design}") on the 100x100 grid, cropped to its ink box. */`,
    `export const BRAND_MARK_VIEWBOX = '${bx1} ${by1} ${inkW} ${inkH}';`,
    '/** Width / height of the mark. */',
    `export const BRAND_MARK_ASPECT = ${+(inkW / inkH).toFixed(4)};`,
    '/** Filled path data of the mark (draw with the evenodd fill rule if BRAND_MARK_EVENODD). */',
    `export const BRAND_MARK_PATHS = [${paths.map((p) => `'${compactPath(p.d)}'`).join(', ')}];`,
    `export const BRAND_MARK_EVENODD = ${paths.some((p) => p.evenOdd)};`,
    '',
    '/** Mark colour on dark and on light backgrounds (brand/logo/logo.config.json). */',
    `export const BRAND_MARK_ON_DARK = '${config.mark.onDark}';`,
    `export const BRAND_MARK_ON_LIGHT = '${config.mark.onLight}';`,
    '/** App-icon tile: gradient and flat fallback. */',
    `export const BRAND_TILE_FROM = '${T.gradientFrom}';`,
    `export const BRAND_TILE_TO = '${T.gradientTo}';`,
    `export const BRAND_TILE_FLAT = '${T.flat}';`,
    '',
    '/** The app-icon tile as a standalone SVG document (public/musilynk-mark.svg), for image renderers. */',
    `export const BRAND_TILE_SVG = ${JSON.stringify(tileSvg.trim())};`,
    '',
  ];
  let ts = lines.join('\n');
  const file = 'src/app/lib/brandMark.generated.ts';
  try {
    const prettier = await import('prettier');
    const opts = (await prettier.resolveConfig(out(file))) ?? {};
    ts = await prettier.format(ts, { ...opts, filepath: out(file) });
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  emit(file, ts);
}

if (check) {
  if (stale.length) {
    console.error(`Out of date (run npm run brand:build):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Logo outputs are up to date.');
  process.exit(0);
}

// ---- raster outputs (@resvg/resvg-js) -------------------------------------------------------------
let Resvg;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
} catch {
  console.error(
    '\nThe PNG/ICO assets need @resvg/resvg-js, which is not installed. Run `npm i -D @resvg/resvg-js`\n' +
      'and `npm run brand:build` again. (Vector assets and the TS module above were written.)',
  );
  process.exit(1);
}
// markInkBox in the config centres the mark everywhere; warn if it does not match the drawing.
{
  const bbox = new Resvg(svgDoc(100, 100, pathEls(paths, '#000'))).getBBox();
  const actual = bbox && [bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height];
  if (actual && actual.some((v, i) => Math.abs(v - config.markInkBox[i]) > 0.5)) {
    console.warn(
      `  warning: markInkBox is ${JSON.stringify(config.markInkBox)} but mark.svg spans ${JSON.stringify(actual.map((v) => +v.toFixed(2)))}`,
    );
  }
}
const fontFiles = ['Manrope-700.ttf', 'Manrope-500.ttf'].map((f) => src(`fonts/${f}`));
function png(svg, width, background) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background,
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Manrope' },
    shapeRendering: 2,
  })
    .render()
    .asPng();
}
const tilePng = (size, opts, background) => png(svgDoc(size, size, tile(size, opts)), size, background);

emit('public/icon-512.png', tilePng(512));
emit('public/icon-192.png', tilePng(192));
emit('public/maskable-512.png', tilePng(512, { full: true, glyphW: PAD.maskable }, T.flat));
emit('public/apple-touch-icon.png', tilePng(180, { full: true, glyphW: PAD.appleTouch }, T.flat));
emit('public/email-mark-64.png', tilePng(64));
emit(`${kit}/musilynk-avatar-640.png`, tilePng(640, { full: true, glyphW: PAD.avatar }, T.flat));

// favicon.ico: PNG-encoded 16/32/48 entries; 16 uses the small cut and tighter padding, 32 and 48 the icon tile.
{
  const sizes = [16, 32, 48];
  const imgs = sizes.map((s) =>
    Buffer.from(
      s <= 16 ? tilePng(s, { glyphW: PAD.smallTile, radius: T.smallCornerRadius, cut: smallPaths }) : tilePng(s),
    ),
  );
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    head.writeUInt8(s, o);
    head.writeUInt8(s, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(imgs[i].length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += imgs[i].length;
  });
  const ico = Buffer.concat([head, ...imgs]);
  emit('public/favicon.ico', ico);
}

// OG image 1200x630: lockup + the site's tagline on Night, the mark large and faint behind.
{
  const W = 1200;
  const H = 630;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lock = lockup(92, 150, 104, config.mark.onDark, colors.white);
  const ghost = glyph(760, 70, 520, colors.white);
  const svg = svgDoc(
    W,
    H,
    `<defs><radialGradient id="glow" cx="0.85" cy="0.1" r="0.75"><stop offset="0" stop-color="${colors.violet}" stop-opacity=".55"/>` +
      `<stop offset=".6" stop-color="${colors.violet}" stop-opacity=".08"/><stop offset="1" stop-color="${colors.violet}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="glow2" cx="0.05" cy="1" r="0.6"><stop offset="0" stop-color="${T.gradientTo}" stop-opacity=".35"/>` +
      `<stop offset="1" stop-color="${T.gradientTo}" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="${OG.background}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>` +
      `<rect width="${W}" height="${H}" fill="url(#glow2)"/><g opacity=".07">${ghost.svg}</g>${lock.svg}` +
      `<text x="92" y="372" font-family="Manrope" font-weight="700" font-size="50" fill="${colors.white}">${esc(OG.headline)}</text>` +
      `<text x="92" y="432" font-family="Manrope" font-weight="700" font-size="50" fill="${colors.lilac}">${esc(OG.highlight)}</text>` +
      `<text x="92" y="520" font-family="Manrope" font-weight="500" font-size="26" fill="#cbd5e1">${esc(OG.subline)}</text>`,
  );
  emit('public/og-default.png', png(svg, W));
}

// Email header images (lockup 44 px tall on a 64 px band, rendered at 2x).
for (const [name, m, t, bg] of [
  ['email-header.png', config.mark.onDark, colors.white, config.email.headerBackground],
  ['email-header-light.png', config.mark.onLight, colors.ink, colors.white],
]) {
  const lh = 30;
  const l = lockup(12, (64 - lh) / 2, lh, m, t);
  const w = Math.ceil(l.w) + 24;
  emit(`${kit}/${name}`, png(svgDoc(w, 64, `<rect width="${w}" height="64" fill="${bg}"/>${l.svg}`), w * 2));
}
console.log('done');
