'use client';

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';
import { Button } from './button';

export type ConfirmOptions = {
  title: string;
  /** Say what will happen and whether it can be undone. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button; use for deletes / removals. Default true. */
  destructive?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** May be async: the dialog stays open with the button disabled until it settles. */
  onConfirm: () => void | Promise<unknown>;
};

/**
 * Controlled confirm dialog. Fits 360px screens, scrolls if the copy is long, buttons are 44px tall on mobile.
 *
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title="Remove this slot?"
 *     description="Hirers will no longer see it." confirmLabel="Remove" onConfirm={() => remove(id)} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const run = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // the caller shows its own error; keep the dialog open so the person can retry or cancel
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild={typeof description !== 'string'}>
            {typeof description === 'string' || description == null ? description : <div>{description}</div>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11 sm:min-h-10">
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={run}
            className="min-h-11 sm:min-h-10"
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Promise-style helper so a click handler can simply `await`.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   const onRemove = async () => {
 *     if (!(await confirm({ title: 'Remove this slot?', confirmLabel: 'Remove' }))) return;
 *     await api.delete(...);
 *   };
 *   return <>... {confirmDialog}</>;
 */
export function useConfirm() {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    [],
  );
  const settle = (ok: boolean) => {
    setState((current) => {
      current?.resolve(ok);
      return null;
    });
  };
  const confirmDialog = (
    <ConfirmDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={state?.title ?? ''}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      destructive={state?.destructive}
      onConfirm={() => settle(true)}
    />
  );
  return { confirm, confirmDialog };
}
