import { describe, expect, it, vi } from 'vitest';

const mountProblemReport = vi.hoisted(() => vi.fn());
vi.mock('../../components/mountProblemReport', () => ({ mountProblemReport }));
import { openProblemReport } from '../problemReportEvent';

describe('openProblemReport', () => {
  it('loads the dialog on demand and hands over the options', async () => {
    const options = { error: new Error('x'), role: 'hirer' };
    openProblemReport(options);
    await vi.waitFor(() => expect(mountProblemReport).toHaveBeenCalledWith(options));
  });

  it('works with no options', async () => {
    mountProblemReport.mockClear();
    openProblemReport();
    await vi.waitFor(() => expect(mountProblemReport).toHaveBeenCalledWith(undefined));
  });
});
