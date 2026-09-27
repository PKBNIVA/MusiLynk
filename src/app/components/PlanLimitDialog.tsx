import {router} from '../routes';
import {useAuth} from '../lib/authContext';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from './ui/alert-dialog';

// The upgrade dialog itself. Loaded on demand by PlanLimitPrompt the first time a plan
// limit is hit, so the dialog library is not part of the first page load.
export default function PlanLimitDialog({message, onClose}: {message: string | null; onClose: () => void}) {
  const {user} = useAuth();

  return <AlertDialog open={message !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Plan limit reached</AlertDialogTitle>
        <AlertDialogDescription>{message} Upgrade to add more capacity; your existing work is kept.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Not now</AlertDialogCancel>
        <AlertDialogAction onClick={() => { onClose(); router.navigate(user?.role === 'employer' ? '/employer/billing' : '/jobseeker/billing'); }}>See plans</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
