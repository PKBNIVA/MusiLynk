// Turns a server-rendered share-card SVG into a real PNG in the browser (Instagram stories and
// phone galleries cannot use SVG). The SVG uses system fonts and no external <image> hrefs, so
// drawing it on a canvas does not taint it. Imported lazily by ShareBadgeSection.
export const CARD_SIZES = {
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 630 },
} as const;

export type CardVariant = keyof typeof CARD_SIZES;

export const cardFilename = (slug: string) => `verse-verified-${slug.replace(/[^A-Za-z0-9_-]/g, '-')}.png`;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the card image.'));
    img.src = url;
  });
}

/** Fetches the SVG and draws it on a canvas of the variant's size at devicePixelRatio 1. */
export async function rasteriseCard(svgUrl: string, variant: CardVariant): Promise<Blob> {
  const { width, height } = CARD_SIZES[variant];
  const response = await fetch(svgUrl);
  if (!response.ok) throw new Error('Could not load the card.');
  const svgBlob = new Blob([await response.text()], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the PNG.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent);

/** Rasterises and downloads `verse-verified-<slug>.png`; on iOS opens it in a new tab instead. */
export async function downloadCardPng(
  svgUrl: string,
  variant: CardVariant,
  slug: string,
): Promise<'downloaded' | 'opened'> {
  const png = await rasteriseCard(svgUrl, variant);
  const url = URL.createObjectURL(png);
  if (isIos()) {
    window.open(url, '_blank');
    return 'opened';
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = cardFilename(slug);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
