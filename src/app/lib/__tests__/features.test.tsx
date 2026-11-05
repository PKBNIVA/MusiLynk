import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('../features');
}

afterEach(() => vi.unstubAllEnvs());

describe('feature flags: build-time defaults (first paint)', () => {
  it('defaults FEATURE_STAGE on when VITE_FEATURE_STAGE is unset', async () => {
    vi.stubEnv('VITE_FEATURE_STAGE', undefined as unknown as string);
    const { FEATURE_STAGE, featureEnabled } = await load();
    expect(FEATURE_STAGE).toBe(true);
    expect(featureEnabled('stage')).toBe(true);
  });

  it.each(['false', '0'])('turns FEATURE_STAGE off when VITE_FEATURE_STAGE is %s', async (value) => {
    vi.stubEnv('VITE_FEATURE_STAGE', value);
    const { FEATURE_STAGE, featureEnabled } = await load();
    expect(FEATURE_STAGE).toBe(false);
    expect(featureEnabled('stage')).toBe(false);
  });

  it.each(['true', 'yes', ''])('keeps FEATURE_STAGE on for any other value (%s)', async (value) => {
    vi.stubEnv('VITE_FEATURE_STAGE', value);
    const { FEATURE_STAGE } = await load();
    expect(FEATURE_STAGE).toBe(true);
  });

  it('defaults FEATURE_RESUMES off when VITE_FEATURE_RESUMES is unset', async () => {
    vi.stubEnv('VITE_FEATURE_RESUMES', undefined as unknown as string);
    const { FEATURE_RESUMES, featureEnabled } = await load();
    expect(FEATURE_RESUMES).toBe(false);
    expect(featureEnabled('resumes')).toBe(false);
  });

  it.each(['true', '1'])('turns FEATURE_RESUMES on when VITE_FEATURE_RESUMES is %s', async (value) => {
    vi.stubEnv('VITE_FEATURE_RESUMES', value);
    const { FEATURE_RESUMES } = await load();
    expect(FEATURE_RESUMES).toBe(true);
  });
});

describe('feature flags: server values replace the build-time defaults', () => {
  it('the anonymous server answer (/api/public/config) wins over the build default', async () => {
    vi.stubEnv('VITE_FEATURE_STAGE', undefined as unknown as string);
    const { featureEnabled, setServerFeatures } = await load();
    expect(featureEnabled('stage')).toBe(true);
    setServerFeatures({ stage: false, resumes: true });
    expect(featureEnabled('stage')).toBe(false);
    expect(featureEnabled('resumes')).toBe(true);
  });

  it("the signed-in person's flags (/api/me) win over the anonymous answer", async () => {
    const { featureEnabled, setServerFeatures, setUserFeatures } = await load();
    setServerFeatures({ stage: true, resumes: false });
    setUserFeatures({ stage: true, resumes: true });
    expect(featureEnabled('resumes')).toBe(true);
    setUserFeatures(null);
    expect(featureEnabled('resumes')).toBe(false);
  });

  it('a flag the server does not know falls through to the next source', async () => {
    vi.stubEnv('VITE_FEATURE_RESUMES', 'true');
    const { featureEnabled, setServerFeatures, setUserFeatures } = await load();
    setServerFeatures({ stage: true });
    setUserFeatures({ stage: false });
    expect(featureEnabled('stage')).toBe(false);
    expect(featureEnabled('resumes')).toBe(true);
  });

  it('ignores a malformed answer', async () => {
    const { featureEnabled, setServerFeatures, setUserFeatures } = await load();
    setServerFeatures('nope' as unknown as Record<string, boolean>);
    setUserFeatures(undefined);
    expect(featureEnabled('stage')).toBe(true);
  });

  it('useFeature re-renders when a server answer lands', async () => {
    const { useFeature, setServerFeatures, resetFeatures } = await load();
    resetFeatures();
    const Probe = () => <span data-testid="flag">{useFeature('resumes') ? 'on' : 'off'}</span>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('off');
    act(() => setServerFeatures({ resumes: true }));
    expect(container.textContent).toBe('on');
    act(() => setServerFeatures({ resumes: false }));
    expect(container.textContent).toBe('off');
    act(() => root.unmount());
    container.remove();
  });
});
