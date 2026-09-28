import type { ReactNode } from 'react';

// http/https only — never linkify javascript:, data: or other schemes. A trailing character that
// is very unlikely to belong to a URL (closing punctuation, a sentence's full stop) is left as
// plain text so "See https://verse.example.com." doesn't swallow the period into the link.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[).,!?;:'"”’]+$/;

/**
 * Renders `text` as plain, already-escaped React text nodes with any `http(s)://` URL turned into
 * a link (`rel="noopener noreferrer"`, opens in a new tab). Nothing here uses `dangerouslySetInnerHTML`,
 * so the rest of the text can never be interpreted as markup.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text))) {
    let url = match[0];
    let end = match.index + url.length;
    const trimmed = url.match(TRAILING_PUNCTUATION)?.[0];
    if (trimmed) {
      url = url.slice(0, -trimmed.length);
      end -= trimmed.length;
    }
    if (!url) continue;
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {url}
      </a>,
    );
    lastIndex = end;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
