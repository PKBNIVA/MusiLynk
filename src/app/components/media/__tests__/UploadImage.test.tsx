import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (el: ReactElement) => act(() => root.render(<MemoryRouter>{el}</MemoryRouter>));

import { UploadImage } from '../UploadImage';
import { UserAvatar } from '../../kit/UserAvatar';
import { ActCover } from '../../talent/ActCard';
import { IMAGE_SIZES, type ImageSet } from '../../../lib/imageSet';
import type { Act } from '../../../lib/apiTypes';

const base = 'https://media.example.test/uploads/u/k/photo.jpg';
const set: ImageSet = {
  src: base,
  srcset: {
    avif: [`${base}/v/320.avif 320w`, `${base}/v/768.avif 768w`],
    webp: [`${base}/v/320.webp 320w`, `${base}/v/768.webp 768w`],
  },
  width: 1500,
  height: 1000,
};

describe('UploadImage', () => {
  it('renders a <picture> with AVIF then WebP sources, sizes for the placement and the original as the fallback', () => {
    show(<UploadImage image={set} alt="Stage" placement="card" className="w-full" />);
    const picture = host.querySelector('picture') as HTMLPictureElement;
    expect(picture.className).toBe('contents');
    const sources = [...picture.querySelectorAll('source')];
    expect(sources.map((s) => s.getAttribute('type'))).toEqual(['image/avif', 'image/webp']);
    expect(sources[0].getAttribute('srcset')).toBe(`${base}/v/320.avif 320w, ${base}/v/768.avif 768w`);
    expect(sources[1].getAttribute('srcset')).toBe(`${base}/v/320.webp 320w, ${base}/v/768.webp 768w`);
    sources.forEach((s) => expect(s.getAttribute('sizes')).toBe(IMAGE_SIZES.card));
    const img = picture.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(base);
    expect(img.getAttribute('width')).toBe('1500');
    expect(img.getAttribute('height')).toBe('1000');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('fetchpriority')).toBeNull();
    expect(img.className).toBe('w-full');
    expect(img.getAttribute('alt')).toBe('Stage');
  });
  it('is a plain lazy <img> on the URL when there is no set, and nothing without a URL', () => {
    show(<UploadImage src={base} alt="" placement="post" />);
    expect(host.querySelector('picture')).toBeNull();
    const img = host.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(base);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.hasAttribute('width')).toBe(false);
    show(<UploadImage image={{ ...set, srcset: {} }} src={base} alt="" placement="post" />);
    expect(host.querySelector('picture')).toBeNull();
    show(<UploadImage image={null} src={null} alt="" placement="post" />);
    expect(host.querySelector('img')).toBeNull();
  });
  it('sizes a fixed box by its pixels and loads eagerly at high priority above the fold', () => {
    show(<UploadImage image={set} alt="" placement="avatar" width={56} height={56} priority />);
    const img = host.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('56');
    expect(img.getAttribute('height')).toBe('56');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    host.querySelectorAll('source').forEach((s) => expect(s.getAttribute('sizes')).toBe('56px'));
  });
  it('offers only the formats the set has', () => {
    show(<UploadImage image={{ ...set, srcset: { webp: set.srcset.webp } }} alt="" placement="postTile" />);
    const sources = [...host.querySelectorAll('source')];
    expect(sources.map((s) => s.getAttribute('type'))).toEqual(['image/webp']);
    expect(sources[0].getAttribute('sizes')).toBe(IMAGE_SIZES.postTile);
  });
});

describe('UserAvatar with an image set', () => {
  it('draws the photo as a <picture> sized to the disc, and falls back to the URL when the set is for another photo', () => {
    show(<UserAvatar id="u1" name="Asha Sharma" size="lg" photoUrl={base} photo={set} />);
    const disc = host.querySelector('[data-testid=user-avatar][data-layer=photo]') as HTMLElement;
    expect(disc).not.toBeNull();
    expect(disc.querySelectorAll('source')).toHaveLength(2);
    expect(disc.querySelector('source')?.getAttribute('sizes')).toBe('56px');
    const img = disc.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('56');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    show(<UserAvatar id="u1" name="Asha Sharma" photoUrl="https://lh3.example/google.jpg" photo={set} eager />);
    expect(host.querySelector('picture')).toBeNull();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://lh3.example/google.jpg');
    expect(host.querySelector('img')?.getAttribute('loading')).toBe('eager');
  });
});

describe('ActCover with an image set', () => {
  const actBase = {
    id: 'act-1',
    name: 'Band',
    act_type: 'band',
    genres: [],
    languages: [],
    event_types: [],
  } as unknown as Act;
  it('lazy-loads a card cover and eagerly loads a header cover, each with the placement sizes', () => {
    show(<ActCover act={{ ...actBase, photo_url: base, photo: set }} height={112} />);
    const card = host.querySelector('[data-testid=act-cover]') as HTMLElement;
    expect(card.style.height).toBe('112px');
    expect(card.querySelector('source')?.getAttribute('sizes')).toBe(IMAGE_SIZES.card);
    expect(card.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    show(<ActCover act={{ ...actBase, photo_url: base, photo: set }} height={220} placement="header" />);
    expect(host.querySelector('source')?.getAttribute('sizes')).toBe(IMAGE_SIZES.header);
    expect(host.querySelector('img')?.getAttribute('fetchpriority')).toBe('high');
  });
  it('shows generated art, not the photo, for a demo act', () => {
    show(<ActCover act={{ ...actBase, demo: true, photo_url: base, photo: set }} height={112} />);
    expect(host.querySelector('img')).toBeNull();
  });
});
