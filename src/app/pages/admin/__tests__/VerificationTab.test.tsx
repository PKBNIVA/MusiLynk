import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
import { apiGet, apiPatch, apiPost } from '../../../lib/api';
import VerificationTab, { checksFromBreakdown, scoreBand } from '../VerificationTab';
import type { AdminVerification } from '../../../lib/apiTypes';
import type { AdminActions, Confirm } from '../shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(apiGet).mockResolvedValue({
    days7: { total: 12, autoApproved: 3, autoApprovalRate: 25, auditSample: 1 },
    days30: { total: 40, autoApproved: 14, autoApprovalRate: 35, auditSample: 2 },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

const row = (over: Partial<AdminVerification> = {}): AdminVerification => ({
  id: 'v1',
  user_id: 'u1',
  kind: 'professional',
  status: 'pending',
  created_at: '2026-09-01T00:00:00Z',
  name: 'Rahul Sharma',
  email: 'rahul@example.com',
  role: 'jobseeker',
  ...over,
});

function setup(verifications: AdminVerification[]) {
  let confirm: Confirm | null = null;
  const actions: AdminActions = {
    busy: null,
    act: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
    setConfirm: (c) => {
      confirm = c;
    },
    setGrant: vi.fn(),
  };
  act(() =>
    root.render(
      <VerificationTab
        verifications={verifications}
        loading={false}
        retry={() => {}}
        actions={actions}
        onPage={() => {}}
      />,
    ),
  );
  return { actions, getConfirm: () => confirm };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const button = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(label)) as
    HTMLButtonElement | undefined;

describe('scoreBand', () => {
  it('colours by band: >= 75 green, 40-74 amber, < 40 or unscored grey', () => {
    expect(scoreBand(75)).toBe('green');
    expect(scoreBand(100)).toBe('green');
    expect(scoreBand(74)).toBe('amber');
    expect(scoreBand(40)).toBe('amber');
    expect(scoreBand(39)).toBe('grey');
    expect(scoreBand(0)).toBe('grey');
    expect(scoreBand(null)).toBe('grey');
    expect(scoreBand(undefined)).toBe('grey');
  });
});

describe('checksFromBreakdown', () => {
  it('pre-checks identity >= 15, work links >= 10, credits (on-platform) >= 10', () => {
    const b = (identity: number, links: number, community: number) =>
      row({
        evidence_breakdown: {
          identity: { score: identity, max: 30 },
          links: { score: links, max: 30 },
          community: { score: community, max: 20 },
        },
      });
    expect(checksFromBreakdown(b(15, 10, 10))).toEqual(['identity', 'work_links', 'credits']);
    expect(checksFromBreakdown(b(14, 9, 9))).toEqual([]);
    expect(checksFromBreakdown(b(30, 0, 10))).toEqual(['identity', 'credits']);
    expect(checksFromBreakdown(row())).toEqual([]);
  });
});

describe('VerificationTab', () => {
  it('renders the score badge in its band, flag chips and the summary', async () => {
    setup([
      row({ id: 'a', evidence_score: 82, summary: 'Line one.\nLine two.\nLine three.' }),
      row({ id: 'b', name: 'Mid Person', evidence_score: 55, flags: ['duplicate_links', 'velocity'] }),
      row({ id: 'c', name: 'Low Person', evidence_score: 12, auto_decision: 'needs_more_proof' }),
      row({ id: 'd', name: 'Unscored Person' }),
    ]);
    await flush();
    const bands = Array.from(container.querySelectorAll('[data-band]')).map((el) => el.getAttribute('data-band'));
    expect(bands).toEqual(['green', 'amber', 'grey', 'grey']);
    expect(container.querySelector('[aria-label="Evidence score 82 out of 100"]')?.textContent).toBe('82');
    expect(container.querySelector('[aria-label="Not scored yet"]')?.textContent).toBe('—');
    expect(Array.from(container.querySelectorAll('[data-flag]')).map((el) => el.textContent)).toEqual([
      'Duplicate links',
      'Many requests',
    ]);
    expect(container.textContent).toContain('Line one.');
    expect(container.textContent).toContain('Asked for more proof');
  });

  it('shows the auto-approval rate and audit-sample count for 7 and 30 days', async () => {
    setup([row()]);
    await flush();
    const text = container.querySelector('[data-testid="verification-stats"]')?.textContent ?? '';
    expect(text).toContain('7 days: 3 of 12 auto-approved (25%), 1 in audit sample');
    expect(text).toContain('30 days: 14 of 40 auto-approved (35%), 2 in audit sample');
  });

  it('hides the stats line when the stats endpoint fails', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('nope'));
    setup([row()]);
    await flush();
    expect(container.querySelector('[data-testid="verification-stats"]')).toBeNull();
  });

  it('filters to the audit sample, where an auto-approved row offers Revoke', async () => {
    const { getConfirm, actions } = setup([
      row({ id: 'pending', name: 'Pending Person', evidence_score: 50 }),
      row({
        id: 'auto',
        name: 'Auto Person',
        status: 'approved',
        auto_decision: 'auto_approved',
        audit_sample: true,
        evidence_score: 90,
      }),
      row({ id: 'plain', name: 'Plain Approved', status: 'approved', evidence_score: 80 }),
    ]);
    await flush();
    expect(container.textContent).toContain('Pending Person');
    expect(container.textContent).not.toContain('Auto Person');
    expect(button('Audit sample (1)')).toBeDefined();

    act(() => button('Audit sample')!.click());
    expect(container.textContent).toContain('Auto Person');
    expect(container.textContent).toContain('Auto-approved');
    expect(container.textContent).not.toContain('Pending Person');
    expect(button('Approve')).toBeUndefined();

    act(() => button('Revoke')!.click());
    const confirm = getConfirm()!;
    expect(confirm.title).toContain('Revoke verification');
    vi.mocked(apiPost).mockResolvedValue({ ok: true });
    await confirm.run('');
    const request = vi.mocked(actions.act).mock.calls[0]!;
    expect(request[0]).toBe('ver:auto');
    await (request[1] as () => Promise<unknown>)();
    expect(apiPost).toHaveBeenCalledWith('/admin/verifications/auto/revoke');
  });

  it('shows the empty state per view', async () => {
    setup([]);
    await flush();
    expect(container.textContent).toContain('No verification requests waiting.');
    act(() => button('Audit sample')!.click());
    expect(container.textContent).toContain('No audit-sample approvals to look at.');
  });

  it('one-click Approve sends the checks pre-selected from the breakdown', async () => {
    const { actions } = setup([
      row({
        id: 'strong',
        evidence_score: 88,
        evidence_breakdown: {
          identity: { score: 30, max: 30 },
          links: { score: 20, max: 30 },
          community: { score: 5, max: 20 },
        },
      }),
    ]);
    await flush();
    act(() => button('Approve')!.click());
    expect(actions.patch).toHaveBeenCalledWith(
      'ver:strong',
      '/admin/verifications/strong',
      { status: 'approved', checks: ['identity', 'work_links'] },
      'Verification approved',
    );
  });

  it('Approve opens the checks dialog when the breakdown suggests none, and Choose checks pre-selects', async () => {
    const { actions } = setup([row({ id: 'weak', evidence_score: 45 })]);
    await flush();
    act(() => button('Approve')!.click());
    expect(actions.patch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('What did you check?');
    const submit = button('Approve with these checks')!;
    expect(submit.disabled).toBe(true);
    const boxes = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]'),
    );
    act(() => boxes[0]!.click());
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(actions.patch).toHaveBeenCalledWith(
      'ver:weak',
      '/admin/verifications/weak',
      { status: 'approved', checks: ['identity'] },
      'Verification approved',
    );
  });

  it('Choose checks opens the dialog with the suggested checks ticked', async () => {
    setup([row({ id: 's', evidence_score: 80, evidence_breakdown: { identity: { score: 20, max: 30 } } })]);
    await flush();
    act(() => button('Choose checks')!.click());
    const boxes = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]'),
    );
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false, false]);
  });

  it('Reject asks for a reason and sends it', async () => {
    const { getConfirm, actions } = setup([row({ id: 'r1', evidence_score: 20 })]);
    await flush();
    act(() => button('Reject')!.click());
    const confirm = getConfirm()!;
    expect(confirm.reasonRequired).toBe(true);
    expect(confirm.destructive).toBe(true);
    await confirm.run('Link is private.');
    const call = vi.mocked(actions.act).mock.calls[0]!;
    expect(call[0]).toBe('ver:r1');
    vi.mocked(apiPatch).mockResolvedValue({ ok: true });
    await (call[1] as () => Promise<unknown>)();
    expect(apiPatch).toHaveBeenCalledWith('/admin/verifications/r1', {
      status: 'rejected',
      reason: 'Link is private.',
    });
  });
});
