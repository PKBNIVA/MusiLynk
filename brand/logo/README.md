# MusiLynk logo: the one place to change it

Current logo: **A4 "One-line M"**. One unbroken line of constant weight draws the M; its diagonals
cross and close in a round loop (the link) at the heart of the letter.

Everything that shows the logo (the header glyph, favicons, app and PWA icons, the OG share image,
the OG card function, the email header mark, the WhatsApp avatar, the lockup SVGs) is generated from
the files in this folder. Never edit a generated file by hand; a unit test fails if one drifts.

## Sources (edit these)

| File | What it is |
|------|------------|
| `mark.svg` | The symbol only. `viewBox="0 0 100 100"`, one or more `<path>` elements with `fill="currentColor"` (optionally `fill-rule="evenodd"`). No strokes, masks, clip paths, transforms or other shapes. |
| `mark-small.svg` | Optional heavier cut used at 16 px (favicon). Same rules. Delete it to use `mark.svg` at every size. |
| `logo.config.json` | `markInkBox` (the mark's ink bounds on the 100 grid, `[x1, y1, x2, y2]`), palette, tile gradient and flat colour, corner radius (fraction of the tile), padding (mark width as a fraction of the tile for each icon type), lockup ratios, OG copy. |
| `wordmark.svg` | "MusiLynk" in Manrope Bold, outlined (cap height 100, baseline y=0). Changes only if the name or its typeface changes. |
| `fonts/` | Manrope 700/500 (Latin subset, SIL OFL) for the OG image text. |

## Swap the logo

1. Replace `mark.svg` with the new symbol: draw it on a 100 x 100 artboard, outline every stroke
   (Figma: *Outline stroke* then *Flatten*; Illustrator: *Object > Path > Outline Stroke* then
   *Pathfinder > Unite*; Inkscape: *Path > Stroke to Path* then *Path > Union*), export as SVG and set
   every `fill` to `currentColor`. Delete `mark-small.svg`, or replace it with a heavier small cut.
2. Adjust `logo.config.json`: set `markInkBox` to the new mark's bounds, and change colours, the tile
   gradient, `cornerRadius` or `padding` if the new design needs it.
3. Run one command:

   ```sh
   npm i -D @resvg/resvg-js   # once: the PNG/ICO renderer is not a dependency of this repo
   npm run brand:build
   ```

   Then drop the `@resvg/resvg-js` change from `package.json`/`package-lock.json` (or keep it, if you
   want it permanently) and commit the regenerated files.

`npm run brand:check` (also run by the unit tests) fails if a vector output or the TS module is out of
date with the sources. Without `@resvg/resvg-js`, `brand:build` still writes the vector outputs and the
TS module, then stops with the install hint before the PNG/ICO step.

## What `brand:build` writes

| Output | Used by |
|--------|---------|
| `public/favicon.svg`, `public/favicon.ico` (16/32/48) | Browser tabs (public and admin sites) |
| `public/icon-192.png`, `public/icon-512.png`, `public/maskable-512.png` | Web app manifest, push notifications |
| `public/apple-touch-icon.png` | iOS home screen |
| `public/musilynk-mark.svg` | The tile as SVG; the system author avatar (`Post::SYSTEM_AVATAR`) |
| `public/email-mark-64.png` | Email header (`EmailDelivery.brand_header_html`) |
| `public/og-default.png` | Default social share image (1200 x 630) |
| `public/manifest.webmanifest`, `index.html` | Theme and background colour (`colors.night`) |
| `src/app/lib/brandMark.generated.ts` | `BrandGlyph`/`BrandMark` in the app header, the OG card function (`api/_lib/og.ts`) |
| `backend/config/brand_logo.json` | `Brand::TILE_COLOR`, the email header's no-images fallback |
| `brand/logo/kit/` | The rest of the kit: `musilynk-avatar-640.png` (WhatsApp/social profile picture), horizontal lockups (colour and one-colour, dark and light), one-colour marks, wordmarks, email header images and a snippet |

## Usage notes

- On dark backgrounds the mark is Lilac `#A99BFF` with a white wordmark; on light backgrounds Violet
  `#5B3CF0` with an Ink `#0E0B1F` wordmark. The app tile is a `#6C4DFF` to `#4A2BD6` gradient (flat
  fallback `#5B3CF0`) with a white mark.
- In the UI, the name next to the glyph stays live HTML text (accessible, translatable); only the
  glyph comes from here.
