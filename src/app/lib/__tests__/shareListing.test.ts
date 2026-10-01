import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { listingUrl, shareListing } from '../shareListing';

const job = { id: 'job 1', title: 'Session drummer' };
const setNavigator = (value: Partial<Navigator>) => vi.stubGlobal('navigator', value);

describe('shareListing', () => {
  beforeEach(() => {
    toast.success.mockReset();
    toast.info.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds the public address of the opportunity', () => {
    expect(listingUrl('job 1')).toBe(`${window.location.origin}/opportunities/job%201`);
  });

  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    await shareListing(job);
    expect(share).toHaveBeenCalledWith({ title: 'Session drummer', url: listingUrl(job.id) });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as nothing to report', async () => {
    const writeText = vi.fn();
    setNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
      clipboard: { writeText } as never,
    });
    await shareListing(job);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('copies the link when sharing is not available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } as never });
    await shareListing(job);
    expect(writeText).toHaveBeenCalledWith(listingUrl(job.id));
    expect(toast.success).toHaveBeenCalled();
  });

  it('copies the link when the share sheet fails for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: vi.fn().mockRejectedValue(new Error('nope')), clipboard: { writeText } as never });
    await shareListing(job);
    expect(writeText).toHaveBeenCalled();
  });

  it('shows the link when it cannot be copied either', async () => {
    setNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } as never });
    await shareListing(job);
    expect(toast.info).toHaveBeenCalledWith(listingUrl(job.id));
  });
});
