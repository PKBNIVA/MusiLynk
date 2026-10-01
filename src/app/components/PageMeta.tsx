import { useEffect } from 'react';
import { IS_ADMIN_SITE } from '../lib/appTarget';

const SITE = IS_ADMIN_SITE ? 'Verse Admin' : 'Verse';
const DATA_ATTR = 'data-page-meta';

export type PageMetaOptions = {
  canonicalPath?: string;
  image?: string;
  type?: 'website' | 'article' | 'profile';
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

/** VITE_PUBLIC_URL with no trailing slash, or window.location.origin when it was never set. */
function publicUrl() {
  const configured = (import.meta.env?.VITE_PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
}

/** An absolute URL on this site for a path ("/hire/dj/mumbai"); structured data needs full URLs. */
export function absoluteUrl(path: string) {
  return /^https?:\/\//i.test(path) ? path : `${publicUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function ensureMeta(attr: 'name' | 'property', key: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  return tag;
}

function ensureLink(rel: string) {
  let tag = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.rel = rel;
    document.head.appendChild(tag);
  }
  return tag;
}

function ensureJsonLdScript() {
  let tag = document.querySelector<HTMLScriptElement>(`script[type="application/ld+json"][${DATA_ATTR}]`);
  if (!tag) {
    tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.setAttribute(DATA_ATTR, '');
    document.head.appendChild(tag);
  }
  return tag;
}

/**
 * Gives a page its own document title, meta description and social/SEO tags (the SPA otherwise
 * shares the index.html defaults on every route) and restores everything on unmount.
 */
export function usePageMeta(title?: string, description?: string, options: PageMetaOptions = {}) {
  const { canonicalPath, image, type = 'website', noindex = false, jsonLd } = options;

  useEffect(() => {
    if (!title) return;

    const previousTitle = document.title;
    document.title = title.includes(SITE) ? title : `${title} · ${SITE}`;

    const desc = description
      ? description.length > 160
        ? `${description.slice(0, 157).trimEnd()}…`
        : description
      : undefined;

    const base = publicUrl();
    const path = canonicalPath ?? window.location.pathname;
    const canonical = `${base}${path}`;
    const resolvedImage = image
      ? image.startsWith('http')
        ? image
        : `${base}${image.startsWith('/') ? image : `/${image}`}`
      : `${base}/og-default.png`;

    const descTag = ensureMeta('name', 'description');
    const previousDescription = descTag.content;
    if (desc) descTag.content = desc;

    const canonicalTag = ensureLink('canonical');
    const previousCanonical = canonicalTag.href;
    canonicalTag.href = canonical;

    const ogTags: [string, string][] = [
      ['og:title', title],
      ['og:description', desc || ''],
      ['og:type', type],
      ['og:url', canonical],
      ['og:site_name', 'Verse'],
      ['og:image', resolvedImage],
    ];
    const twitterTags: [string, string][] = [
      ['twitter:card', 'summary_large_image'],
      ['twitter:title', title],
      ['twitter:description', desc || ''],
      ['twitter:image', resolvedImage],
    ];

    const restoreOg = ogTags.map(([key, value]) => {
      const tag = ensureMeta('property', key);
      const previous = tag.content;
      tag.content = value;
      return () => {
        tag.content = previous;
      };
    });
    const restoreTwitter = twitterTags.map(([key, value]) => {
      const tag = ensureMeta('name', key);
      const previous = tag.content;
      tag.content = value;
      return () => {
        tag.content = previous;
      };
    });

    let restoreRobots = () => {};
    if (noindex) {
      const robotsTag = ensureMeta('name', 'robots');
      const previous = robotsTag.content;
      robotsTag.content = 'noindex, nofollow';
      restoreRobots = () => {
        robotsTag.content = previous;
      };
    }

    let removeJsonLd = () => {};
    if (jsonLd) {
      const script = ensureJsonLdScript();
      script.text = JSON.stringify(jsonLd).replace(/<\//g, '<\\/');
      removeJsonLd = () => {
        script.remove();
      };
    }

    return () => {
      document.title = previousTitle;
      descTag.content = previousDescription;
      canonicalTag.href = previousCanonical;
      restoreOg.forEach((restore) => restore());
      restoreTwitter.forEach((restore) => restore());
      restoreRobots();
      removeJsonLd();
    };
  }, [title, description, canonicalPath, image, type, noindex, jsonLd]);
}
