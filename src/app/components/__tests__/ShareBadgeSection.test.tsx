import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ track: trackMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShareBadgeSection } from '../ShareBadgeSection';

let container: HTMLDivElement;
let root: Root;

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

beforeEach(() => {
  trackMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ShareBadgeSection', () => {
  it('offers a download, a copy-link and a WhatsApp share, and fires the product events', () => {
    render(<ShareBadgeSection userId="user_123" />);

    const download = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Download story card'),
    ) as HTMLButtonElement;
    act(() => download.click());
    expect(trackMock).toHaveBeenCalledWith('share_card_download');

    const whatsapp = Array.from(container.querySelectorAll('a')).find((a) =>
      a.href.includes('wa.me'),
    ) as HTMLAnchorElement;
    expect(decodeURIComponent(whatsapp.href)).toContain("I'm verified on Verse");
    act(() => whatsapp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(trackMock).toHaveBeenCalledWith('share_whatsapp');

    expect(container.textContent).toContain('Copy profile link');
  });
});
