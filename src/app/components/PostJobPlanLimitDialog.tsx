import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

/**
 * Shown instead of a toast when publishing/submitting an opportunity hits a 402 plan limit
 * (V-14). PostJob has already saved the work as a draft by the time this opens, so the person
 * never loses it, and the dialog stays open (no auto-navigation) until they pick a way forward.
 */
export function PostJobPlanLimitDialog({
  message,
  billingPath,
  closeListingsPath,
  onNavigate,
  onKeepAsDraft,
}: {
  /** The server's plan-limit message, shown verbatim. Null keeps the dialog closed. */
  message: string | null;
  billingPath: string;
  closeListingsPath: string;
  onNavigate: (path: string) => void;
  onKeepAsDraft: () => void;
}) {
  // No onOpenChange: Cancel/Action already close the dialog through their own onClick below, and
  // AlertDialogCancel calling onKeepAsDraft *and* an implicit onOpenChange(false) calling it again
  // would race onKeepAsDraft's navigation against whichever button was actually clicked (it did,
  // in testing). `open` is fully controlled by `message`, so an Escape press leaves the dialog
  // open rather than silently discarding the choice.
  return (
    <AlertDialog open={message !== null}>
      <AlertDialogContent data-testid="plan-limit-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>You&apos;ve reached your plan&apos;s limit</AlertDialogTitle>
          <AlertDialogDescription>{message} We saved this opportunity as a draft.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeepAsDraft}>Keep as draft</AlertDialogCancel>
          <AlertDialogAction onClick={() => onNavigate(closeListingsPath)}>Close another listing</AlertDialogAction>
          <AlertDialogAction onClick={() => onNavigate(billingPath)}>See plans</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
