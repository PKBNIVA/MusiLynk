import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router';
import { AlertTriangle, ShieldCheck, UserCircle2 } from 'lucide-react';
import { getAdminAccount, secondFactorGap } from '../../lib/adminAccount';
import type { AdminAccountHealth } from '../../lib/apiTypes';
import { errorMessage } from '../../lib/errors';
import { AdminBackground } from '../admin/ui';

export interface AdminSiteContext {
  account: AdminAccountHealth | null;
  accountError: string;
  reloadAccount: () => Promise<void>;
}

/** The admin's account health, loaded once by the layout for the banner and the account page. */
export const useAdminSite = () => useOutletContext<AdminSiteContext>();

// Wraps every signed-in admin page: a warning banner while two-step sign-in is not protecting the
// admin, and a link to the admin's own account. The pages themselves render below it.
export default function AdminSiteLayout() {
  const { pathname } = useLocation();
  const [account, setAccount] = useState<AdminAccountHealth | null>(null);
  const [accountError, setAccountError] = useState('');
  const reloadAccount = useCallback(async () => {
    try {
      setAccount(await getAdminAccount());
      setAccountError('');
    } catch (e: unknown) {
      /* The banner stays hidden; the account page shows the error with a retry. */
      setAccountError(errorMessage(e, 'Could not load your account.'));
    }
  }, []);
  useEffect(() => {
    void reloadAccount();
  }, [reloadAccount]);
  const gap = account && secondFactorGap(account);
  const context: AdminSiteContext = { account, accountError, reloadAccount };

  return (
    <>
      <AdminBackground />
      {gap && (
        <aside
          aria-label="Sign-in security warning"
          data-testid="admin-security-banner"
          className="border-b border-amber-300/30 bg-amber-400/15 px-4 py-2.5 text-sm text-amber-50 md:px-6"
        >
          <div className="mx-auto flex max-w-[1500px] items-start gap-2">
            <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <p>
              Two-step sign-in is off for your account because {gap}.{' '}
              {pathname === '/account' ? (
                'Set a real email address below.'
              ) : (
                <Link to="/account" className="font-semibold underline underline-offset-4">
                  Set a real email address
                </Link>
              )}
            </p>
          </div>
        </aside>
      )}
      <nav
        aria-label="Admin site"
        className="border-b border-white/10 bg-slate-950 px-4 text-xs text-slate-400 md:px-6"
      >
        <div className="mx-auto flex h-9 max-w-[1500px] items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider">
            <ShieldCheck aria-hidden="true" size={13} className="text-violet-300" />
            MusiLynk Admin
          </span>
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `inline-flex min-h-9 items-center gap-1.5 font-semibold hover:text-white ${isActive ? 'text-white' : 'text-violet-200'}`
            }
          >
            <UserCircle2 aria-hidden="true" size={14} />
            Your account
          </NavLink>
        </div>
      </nav>
      <Outlet context={context} />
    </>
  );
}
