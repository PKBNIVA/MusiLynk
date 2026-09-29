import { describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('../features');
}

describe('feature flags', () => {
  it('defaults FEATURE_STAGE on when VITE_FEATURE_STAGE is unset', async () => {
    vi.stubEnv('VITE_FEATURE_STAGE', undefined as unknown as string);
    const { FEATURE_STAGE } = await load();
    expect(FEATURE_STAGE).toBe(true);
  });

  it.each(['false', '0'])('turns FEATURE_STAGE off when VITE_FEATURE_STAGE is %s', async (value) => {
    vi.stubEnv('VITE_FEATURE_STAGE', value);
    const { FEATURE_STAGE } = await load();
    expect(FEATURE_STAGE).toBe(false);
  });

  it.each(['true', 'yes', ''])('keeps FEATURE_STAGE on for any other value (%s)', async (value) => {
    vi.stubEnv('VITE_FEATURE_STAGE', value);
    const { FEATURE_STAGE } = await load();
    expect(FEATURE_STAGE).toBe(true);
  });

  it('defaults FEATURE_RESUMES off when VITE_FEATURE_RESUMES is unset', async () => {
    vi.stubEnv('VITE_FEATURE_RESUMES', undefined as unknown as string);
    const { FEATURE_RESUMES } = await load();
    expect(FEATURE_RESUMES).toBe(false);
  });

  it.each(['true', '1'])('turns FEATURE_RESUMES on when VITE_FEATURE_RESUMES is %s', async (value) => {
    vi.stubEnv('VITE_FEATURE_RESUMES', value);
    const { FEATURE_RESUMES } = await load();
    expect(FEATURE_RESUMES).toBe(true);
  });
});
