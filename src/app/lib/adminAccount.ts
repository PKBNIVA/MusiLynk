import { apiGet, apiPost } from './api';
import type { AccountUser, AdminAccountHealth, AdminEmailChangeStarted, Ok } from './apiTypes';

// The admin site's own-account calls (backend Admin::AccountController). Errors surface as
// ApiError with the API's code, e.g. EMAIL_UNDELIVERABLE (422) or EMAIL_TAKEN (409).

export const getAdminAccount = () => apiGet<AdminAccountHealth>('/admin/account');

/** Emails a code to `email`; the returned token and that code confirm the change. */
export const requestAdminEmailChange = (email: string) =>
  apiPost<AdminEmailChangeStarted>('/admin/account/email/request', { email });

/** Switches the admin to the new address and signs out their other sessions. */
export const confirmAdminEmailChange = (changeToken: string, code: string) =>
  apiPost<{ user: AccountUser }>('/admin/account/email/confirm', { changeToken, code });

/** Changes the password and signs out the admin's other sessions. */
export const changeAdminPassword = (currentPassword: string, newPassword: string) =>
  apiPost<Ok>('/admin/account/password', { currentPassword, newPassword });

/**
 * Why two-step sign-in is not protecting this admin, in words that finish the sentence
 * "Two-step sign-in is off for your account because …", or null when it is.
 */
export function secondFactorGap(account: AdminAccountHealth): string | null {
  if (account.emailDeliverable === false) return 'your admin email address cannot receive email';
  switch (account.secondFactor) {
    case 'off':
      return 'it is turned off on the server';
    case 'unavailable':
      return 'the server cannot send email right now';
    case 'skipped':
      return 'the sign-in code could not be emailed to you';
    default:
      /* `enforced`, or a state this build does not know yet: no warning. */
      return null;
  }
}
