import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSuggestButton } from '../AiSuggestButton';

vi.mock('../../../lib/ai', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/ai')>('../../../lib/ai');
  return { ...actual, useAiTaskEnabled: vi.fn(), suggestAi: vi.fn() };
});
import { suggestAi, useAiTaskEnabled } from '../../../lib/ai';
import { ApiError } from '../../../lib/api';

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
});

const $ = (selector: string) => document.querySelector(selector);
const button = () => $('button[aria-label], button') as HTMLButtonElement;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AiSuggestButton', () => {
  it('renders nothing when AI assist does not offer this task', () => {
    vi.mocked(useAiTaskEnabled).mockReturnValue(false);
    act(() => root.render(<AiSuggestButton task="post_caption" getContext={() => ({})} onAccept={() => {}} />));
    expect(container.innerHTML).toBe('');
  });

  it('labels itself Suggest for an empty field and Improve for a filled one', () => {
    vi.mocked(useAiTaskEnabled).mockReturnValue(true);
    act(() => root.render(<AiSuggestButton task="post_caption" getContext={() => ({})} onAccept={() => {}} />));
    expect(button().textContent).toContain('Suggest');

    act(() =>
      root.render(
        <AiSuggestButton task="post_caption" getContext={() => ({})} onAccept={() => {}} value="Already some text" />,
      ),
    );
    expect(button().textContent).toContain('Improve');
  });

  it('requests a suggestion using fresh context when opened, and offers Insert/Replace on success', async () => {
    vi.mocked(useAiTaskEnabled).mockReturnValue(true);
    vi.mocked(suggestAi).mockResolvedValue({ suggestion: 'A shiny new caption', task: 'post_caption', model: 'm' });
    const getContext = vi.fn(() => ({ kind: 'release' }));
    const onAccept = vi.fn();
    act(() =>
      root.render(
        <AiSuggestButton task="post_caption" getContext={getContext} onAccept={onAccept} value="Existing draft" />,
      ),
    );

    act(() => button().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(getContext).toHaveBeenCalled();
    expect(suggestAi).toHaveBeenCalledWith('post_caption', { kind: 'release' }, expect.anything());
    expect(document.body.textContent).toContain('A shiny new caption');

    const replace = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Replace')!;
    act(() => replace.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onAccept).toHaveBeenCalledWith('A shiny new caption');
  });

  it('shows a friendly message and a retry option on failure', async () => {
    vi.mocked(useAiTaskEnabled).mockReturnValue(true);
    vi.mocked(suggestAi).mockRejectedValue(new ApiError('nope', 429, 'RATE_LIMITED'));
    act(() => root.render(<AiSuggestButton task="post_caption" getContext={() => ({})} onAccept={() => {}} />));

    act(() => button().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(document.body.textContent).toContain("You're using AI assist a lot right now");
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
  });
});
