import { toast } from 'sonner';

type UndoToastOptions = {
  /** Called if the person taps Undo within the window. Restore the item here. */
  onUndo: () => void | Promise<unknown>;
  /** Called once the window closes without Undo. Do the real delete here. */
  onCommit?: () => void | Promise<unknown>;
  /** ms before the action becomes permanent. Default 6000. */
  duration?: number;
  /** Shown if onCommit throws. */
  commitErrorMessage?: string;
};

/**
 * Undo pattern for removals: update the UI optimistically, then call this.
 * The destructive request is deferred until the toast closes, so Undo needs no server round-trip.
 *
 *   setItems((list) => list.filter((x) => x.id !== id));
 *   undoToast('Slot removed', {
 *     onUndo: () => setItems(previous),
 *     onCommit: () => api.delete(`/availability/${id}`),
 *   });
 *
 * Note: if the tab closes inside the window the commit does not run, so only use for reversible, low-stakes removals;
 * use ConfirmDialog for anything involving money or other people.
 */
export function undoToast(message: string, options: UndoToastOptions) {
  const { onUndo, onCommit, duration = 6000, commitErrorMessage = 'Could not finish that. Please try again.' } = options;
  let undone = false;
  let settled = false;
  const commit = async () => {
    if (settled || undone) return;
    settled = true;
    try {
      await onCommit?.();
    } catch {
      toast.error(commitErrorMessage);
      await onUndo();
    }
  };
  const id = toast(message, {
    duration,
    action: {
      label: 'Undo',
      onClick: () => {
        if (settled) return;
        undone = true;
        void onUndo();
      },
    },
    onDismiss: () => void commit(),
    onAutoClose: () => void commit(),
  });
  return id;
}
