import { PROFILE_PHOTO_PX, squareCropRect } from '../../lib/photo';

function loadImage(file: File): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, revoke: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image. Choose a JPEG, PNG or WebP picture.'));
    };
    image.src = url;
  });
}

/** Centre-crops an image file to a square of at most 512 px and returns it as a WebP (JPEG where WebP is unavailable). */
export async function cropSquare(file: File, px: number = PROFILE_PHOTO_PX): Promise<File> {
  const { image, revoke } = await loadImage(file);
  try {
    const { sx, sy, side } = squareCropRect(image.naturalWidth, image.naturalHeight);
    const out = Math.min(px, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot prepare this photo. Try another browser.');
    context.drawImage(image, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (blob && blob.type === 'image/webp') return new File([blob], 'photo.webp', { type: 'image/webp' });
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!jpeg) throw new Error('Your browser cannot prepare this photo. Try another browser.');
    return new File([jpeg], 'photo.jpg', { type: 'image/jpeg' });
  } finally {
    revoke();
  }
}
