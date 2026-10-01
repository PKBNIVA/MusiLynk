import { afterEach, describe, expect, it, vi } from 'vitest';

const toastFn = vi.hoisted(() => Object.assign(vi.fn(() => 'id'), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastFn }));

import { undoToast } from '../undoToast';

type Opts = {
  action: { label: string; onClick: () => void };
  onDismiss: () => void;
  onAutoClose: () => void;
  duration: number;
};
const lastOpts = () => (toastFn.mock.calls.at(-1) as unknown as [string, Opts])[1];

afterEach(() => vi.clearAllMocks());

describe('undoToast', () => {
  it('commits once when the toast closes without undo', async () => {
    const onCommit = vi.fn();
    undoToast('Removed', { onUndo: vi.fn(), onCommit });
    lastOpts().onAutoClose();
    lastOpts().onDismiss();
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(lastOpts().duration).toBe(6000);
  });

  it('does not commit after undo', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoToast('Removed', { onUndo, onCommit });
    lastOpts().action.onClick();
    lastOpts().onDismiss();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('restores and reports if the commit fails', async () => {
    const onUndo = vi.fn();
    undoToast('Removed', { onUndo, onCommit: () => Promise.reject(new Error('x')) });
    lastOpts().onAutoClose();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastFn.error).toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalled();
  });
});
