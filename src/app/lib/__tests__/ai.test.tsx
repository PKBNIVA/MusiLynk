import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autocompleteAi,
  loadAiStatus,
  resetAiStatus,
  suggestAi,
  useAiStatus,
  useAiTaskEnabled,
  type AiStatus,
} from '../ai';

vi.mock('../api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
import { apiGet, apiPost } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enabledStatus: AiStatus = { enabled: true, tasks: ['post_caption', 'profile_bio'] };
const disabledStatus: AiStatus = { enabled: false, tasks: [] };

let container: HTMLDivElement;
let root: Root;
let seen: { status: AiStatus | null; captionEnabled: boolean; coverLetterEnabled: boolean };

function Harness() {
  seen = {
    status: useAiStatus(),
    captionEnabled: useAiTaskEnabled('post_caption'),
    coverLetterEnabled: useAiTaskEnabled('cover_letter'),
  };
  return null;
}

beforeEach(() => {
  resetAiStatus();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useAiStatus / useAiTaskEnabled', () => {
  it('starts null, then reflects the fetched status, fetched once', async () => {
    vi.mocked(apiGet).mockResolvedValue(enabledStatus);
    act(() => root.render(<Harness />));
    expect(seen.status).toBeNull();
    expect(seen.captionEnabled).toBe(false);

    await act(async () => {
      await loadAiStatus();
    });
    expect(seen.status).toBe(enabledStatus);
    expect(seen.captionEnabled).toBe(true);
    expect(seen.coverLetterEnabled).toBe(false);

    await loadAiStatus();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/ai/status');
  });

  it('treats a disabled status as every task disabled', async () => {
    vi.mocked(apiGet).mockResolvedValue(disabledStatus);
    act(() => root.render(<Harness />));
    await act(async () => {
      await loadAiStatus();
    });
    expect(seen.captionEnabled).toBe(false);
  });

  it('stays null and retries next time when the fetch fails', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(enabledStatus);
    act(() => root.render(<Harness />));
    await act(async () => {
      await loadAiStatus().catch(() => undefined);
    });
    expect(seen.status).toBeNull();
    await expect(loadAiStatus()).resolves.toBe(enabledStatus);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve!: (value: AiStatus) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise<AiStatus>((res) => (resolve = res)));
    act(() => root.render(<Harness />));
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolve(enabledStatus);
      await loadAiStatus();
    });
    expect(seen.status).toBeNull();
  });
});

describe('suggestAi', () => {
  it('posts the task and structured context, never a raw prompt field', async () => {
    vi.mocked(apiPost).mockResolvedValue({ suggestion: 'Great caption!', task: 'post_caption', model: 'claude-haiku' });
    const result = await suggestAi('post_caption', { kind: 'release', notes: 'new single' });
    expect(apiPost).toHaveBeenCalledWith(
      '/ai/suggest',
      { task: 'post_caption', context: { kind: 'release', notes: 'new single' } },
      { signal: undefined },
    );
    expect(result.suggestion).toBe('Great caption!');
  });

  it('forwards an abort signal', async () => {
    vi.mocked(apiPost).mockResolvedValue({ suggestion: '', task: 'post_caption', model: 'm' });
    const controller = new AbortController();
    await suggestAi('post_caption', { kind: 'release' }, controller.signal);
    expect(apiPost).toHaveBeenCalledWith(expect.anything(), expect.anything(), { signal: controller.signal });
  });
});

describe('autocompleteAi', () => {
  it('encodes the field and query as a GET request', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      field: 'cities',
      query: 'mum',
      suggestions: [{ value: 'Mumbai', source: 'taxonomy' }],
    });
    const result = await autocompleteAi('cities', 'mum');
    expect(apiGet).toHaveBeenCalledWith('/ai/autocomplete?field=cities&q=mum', { signal: undefined });
    expect(result.suggestions).toEqual([{ value: 'Mumbai', source: 'taxonomy' }]);
  });

  it('encodes special characters in the query', async () => {
    vi.mocked(apiGet).mockResolvedValue({ field: 'skills', query: 'a&b', suggestions: [] });
    await autocompleteAi('skills', 'a&b');
    expect(apiGet).toHaveBeenCalledWith('/ai/autocomplete?field=skills&q=a%26b', { signal: undefined });
  });
});
