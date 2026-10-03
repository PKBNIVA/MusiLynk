import { describe, expect, it } from 'vitest';
import { IMAGE_SIZES, hasVariants, imageSizes, srcSetAttr, type ImageSet } from '../imageSet';

const set: ImageSet = {
  src: 'https://media.example.test/uploads/u/k/a.jpg',
  srcset: {
    avif: ['https://media.example.test/uploads/u/k/a.jpg/v/320.avif 320w'],
    webp: [
      'https://media.example.test/uploads/u/k/a.jpg/v/320.webp 320w',
      'https://media.example.test/uploads/u/k/a.jpg/v/768.webp 768w',
    ],
  },
  width: 1200,
  height: 800,
};

describe('imageSet', () => {
  it('sizes a fixed box by its pixel width and a placement by its rule', () => {
    expect(imageSizes('avatar', 56)).toBe('56px');
    expect(imageSizes('thumb', 24)).toBe('24px');
    expect(imageSizes('avatar')).toBe('40px');
    expect(imageSizes('card')).toBe(IMAGE_SIZES.card);
    expect(imageSizes('header')).toBe(IMAGE_SIZES.header);
    expect(imageSizes('post')).toBe(IMAGE_SIZES.post);
    expect(imageSizes('postTile')).toBe(IMAGE_SIZES.postTile);
  });
  it('joins srcset candidates and leaves an empty or missing list out', () => {
    expect(srcSetAttr(set.srcset.webp)).toBe(
      'https://media.example.test/uploads/u/k/a.jpg/v/320.webp 320w, https://media.example.test/uploads/u/k/a.jpg/v/768.webp 768w',
    );
    expect(srcSetAttr([])).toBeUndefined();
    expect(srcSetAttr(undefined)).toBeUndefined();
  });
  it('recognises a usable set and rejects null, empty and sourceless ones', () => {
    expect(hasVariants(set)).toBe(true);
    expect(hasVariants({ ...set, srcset: { avif: [], webp: set.srcset.webp } })).toBe(true);
    expect(hasVariants({ ...set, srcset: {} })).toBe(false);
    expect(hasVariants({ ...set, src: '' })).toBe(false);
    expect(hasVariants(null)).toBe(false);
    expect(hasVariants(undefined)).toBe(false);
  });
});
