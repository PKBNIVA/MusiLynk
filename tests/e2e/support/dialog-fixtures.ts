import type { Page } from '@playwright/test';

// Mocked signed-in API for the report and verification dialog specs.

export const REPORT_JOB_ID = 'job-7';
export const CONVERSATION_ID = 'c1';

export type DialogFixtureState = {
  reports: Record<string, unknown>[];
  verificationRequests: Record<string, unknown>[];
  nativeDialogs: string[];
  pageErrors: string[];
};

export async function signInWithDialogFixtures(page: Page, role: 'jobseeker' | 'employer' = 'jobseeker') {
  const state: DialogFixtureState = { reports: [], verificationRequests: [], nativeDialogs: [], pageErrors: [] };
  page.on('dialog', (dialog) => {
    state.nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/me')
      return json({
        user: {
          id: 'me-1',
          name: 'Asha Rao',
          email: 'asha@example.invalid',
          role,
          status: 'active',
          profileComplete: true,
          emailVerified: true,
          headline: 'Session guitarist',
        },
      });
    if (path === '/reports' && request.method() === 'POST') {
      state.reports.push(request.postDataJSON());
      return json({ id: 'r1' }, 201);
    }
    if (path === '/verification-requests' && request.method() === 'POST') {
      state.verificationRequests.push(request.postDataJSON());
      return json({ id: 'v1' }, 201);
    }
    if (path === `/jobs/${REPORT_JOB_ID}`) {
      return json({
        job: {
          id: REPORT_JOB_ID,
          title: 'Session Guitarist',
          company: 'Verse Studio',
          location: 'Mumbai',
          workplace: 'onsite',
          type: 'Contract',
          opportunity_kind: 'gig',
          description: 'Record guitar parts.',
          skills: ['Guitar'],
          saved: false,
          applied: false,
        },
      });
    }
    if (path === '/conversations') {
      return json({
        conversations: [
          {
            id: CONVERSATION_ID,
            counterpartId: 'u-2',
            counterpartName: 'Pushy Person',
            viewerSide: 'candidate',
            jobTitle: null,
            lastMessage: 'pay me first',
            unreadCount: 0,
          },
        ],
      });
    }
    if (path === `/conversations/${CONVERSATION_ID}/messages`) {
      return json({
        messages: [
          { id: 'm1', senderId: 'u-2', body: 'pay me first', createdAt: '2026-09-20T10:00:00Z', readAt: null },
        ],
        truncated: false,
        limit: 200,
      });
    }
    if (path === '/notifications/unread') return json({ unread: 0, unreadMessages: 0 });
    return json({});
  });
  return state;
}
