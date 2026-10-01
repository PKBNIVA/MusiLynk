// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from '../confirm-dialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ConfirmDialog', () => {
  it('runs onConfirm then closes; cancel does not confirm', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <ConfirmDialog open onOpenChange={onOpenChange} title="Remove it?" confirmLabel="Remove" onConfirm={onConfirm} />,
      ),
    );
    const buttons = Array.from(document.body.querySelectorAll('button'));
    const remove = buttons.find((b) => b.textContent === 'Remove')!;
    const cancel = buttons.find((b) => b.textContent === 'Cancel')!;
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => cancel.click());
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => remove.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => root.unmount());
  });
});
