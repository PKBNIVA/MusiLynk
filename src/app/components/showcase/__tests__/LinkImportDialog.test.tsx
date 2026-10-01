import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/onboarding', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/onboarding')>('../../../lib/onboarding');
  return { ...actual, fetchLinkPreview: vi.fn() };
});
vi.mock('../../../lib/linkImport', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/linkImport')>('../../../lib/linkImport');
  return { ...actual, draftFromLinks: vi.fn(), importDraftToLibrary: vi.fn() };
});

vi.mock('../../join/ProfileDraftReview', () => ({
  default: ({
    result,
    onUse,
    useLabel,
  }: {
    result: DraftResult;
    onUse: (d: DraftResult['draft']) => void;
    useLabel: string;
  }) => (
    <button type="button" onClick={() => onUse(result.draft)}>
      {useLabel}
    </button>
  ),
}));

import { fetchLinkPreview } from '../../../lib/onboarding';
import { draftFromLinks, importDraftToLibrary, type DraftResult } from '../../../lib/linkImport';
import { LinkImportDialog } from '../LinkImportDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

const draftResult: DraftResult = {
  sources: [
    {
      provider: 'youtube',
      kind: 'video',
      label: 'YouTube',
      url: 'https://youtube.com/watch?v=1',
      title: 'A video',
      author: null,
      thumbnail: null,
    },
  ],
  draft: {
    headline: null,
    bio: null,
    roles: [],
    genres: [],
    instruments: [],
    city: null,
    yearsExperience: null,
    credits: [],
    items: [{ url: 'https://youtube.com/watch?v=1', title: 'A video', caption: null }],
  },
  aiUsed: false,
  provenance: {},
};

describe('LinkImportDialog', () => {
  it('renders nothing meaningful when closed', () => {
    act(() => root.render(<LinkImportDialog open={false} onOpenChange={() => {}} onImported={() => {}} />));
    expect(document.body.textContent).not.toContain('Add from a link');
  });

  it('shows the paste box and title when open', () => {
    act(() => root.render(<LinkImportDialog open onOpenChange={() => {}} onImported={() => {}} />));
    expect(document.body.textContent).toContain('Add from a link');
    expect(document.querySelector('#join-link')).toBeTruthy();
  });

  async function pasteLink() {
    vi.mocked(fetchLinkPreview).mockResolvedValue({
      provider: 'youtube',
      kind: 'video',
      label: 'YouTube',
      url: 'https://youtube.com/watch?v=1',
      title: 'A video',
      author: null,
      thumbnail: null,
    });
    const input = document.querySelector('#join-link') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'https://youtube.com/watch?v=1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();
  }

  it('keeps a pasted link when the dialog is closed and reopened', async () => {
    act(() => root.render(<LinkImportDialog open onOpenChange={() => {}} onImported={() => {}} />));
    await pasteLink();
    expect(document.querySelectorAll('[data-testid="work-link"]')).toHaveLength(1);

    act(() => root.render(<LinkImportDialog open={false} onOpenChange={() => {}} onImported={() => {}} />));
    act(() => root.render(<LinkImportDialog open onOpenChange={() => {}} onImported={() => {}} />));
    expect(document.querySelectorAll('[data-testid="work-link"]')).toHaveLength(1);
  });

  it('adds the pasted links straight to the library, then clears them', async () => {
    vi.mocked(importDraftToLibrary).mockResolvedValue({
      portfolioItems: [{ id: 'item-1' }] as never,
      suggestedReview: null,
    });
    const onImported = vi.fn();
    act(() => root.render(<LinkImportDialog open onOpenChange={() => {}} onImported={onImported} />));
    await pasteLink();

    const add = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add to my work'),
    ) as HTMLButtonElement;
    act(() => add.click());
    await flush();

    expect(importDraftToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ url: 'https://youtube.com/watch?v=1', title: 'A video', caption: null }] }),
    );
    expect(onImported).toHaveBeenCalledWith([{ id: 'item-1' }], false);
    expect(document.querySelectorAll('[data-testid="work-link"]')).toHaveLength(0);
  });

  it('drafting then "Add to my work" imports and reports what was added', async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue({
      provider: 'youtube',
      kind: 'video',
      label: 'YouTube',
      url: 'https://youtube.com/watch?v=1',
      title: 'A video',
      author: null,
      thumbnail: null,
    });
    vi.mocked(draftFromLinks).mockResolvedValue(draftResult);
    vi.mocked(importDraftToLibrary).mockResolvedValue({
      portfolioItems: [{ id: 'item-1' }] as never,
      suggestedReview: null,
    });

    const onImported = vi.fn();
    act(() => root.render(<LinkImportDialog open onOpenChange={() => {}} onImported={onImported} />));

    const input = document.querySelector('#join-link') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'https://youtube.com/watch?v=1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();

    const draftButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Draft my profile from these links'),
    ) as HTMLButtonElement;
    expect(draftButton).toBeTruthy();
    act(() => draftButton.click());
    await flush();

    const addButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add to my work'),
    ) as HTMLButtonElement;
    expect(addButton).toBeTruthy();
    act(() => addButton.click());
    await flush();

    expect(importDraftToLibrary).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith([{ id: 'item-1' }], false);
  });
});
