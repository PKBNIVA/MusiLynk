import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FUNCTION_AREAS,
  loadTaxonomy,
  resetTaxonomy,
  talentRoleLabel,
  useFunctionAreas,
  useTaxonomy,
} from '../useTaxonomy';
import type { Taxonomy } from '../apiTypes';

vi.mock('../api', () => ({ apiGet: vi.fn() }));
import { apiGet } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const taxonomy = {
  functionAreas: ['Performance', 'Music Tech'],
  talentRoles: [{ key: 'performer', label: 'Performers' }],
} as Taxonomy;

let container: HTMLDivElement;
let root: Root;
let seen: { taxonomy: Taxonomy | null; functions: string[] };

function Harness() {
  seen = { taxonomy: useTaxonomy(), functions: useFunctionAreas() };
  return null;
}

beforeEach(() => {
  resetTaxonomy();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('taxonomy', () => {
  it('uses the built-in list until the API answers, then the API list, fetched once', async () => {
    vi.mocked(apiGet).mockResolvedValue(taxonomy);
    act(() => root.render(<Harness />));
    expect(seen.functions).toBe(FUNCTION_AREAS);
    await act(async () => {
      await loadTaxonomy();
    });
    expect(seen.taxonomy).toBe(taxonomy);
    expect(seen.functions).toEqual(['Performance', 'Music Tech']);
    await loadTaxonomy();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/taxonomy');
  });

  it('keeps the fallback when loading fails and retries next time', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(taxonomy);
    act(() => root.render(<Harness />));
    await act(async () => {
      await loadTaxonomy().catch(() => undefined);
    });
    expect(seen.taxonomy).toBeNull();
    expect(seen.functions).toBe(FUNCTION_AREAS);
    await expect(loadTaxonomy()).resolves.toBe(taxonomy);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve!: (value: Taxonomy) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise<Taxonomy>((res) => (resolve = res)));
    act(() => root.render(<Harness />));
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolve(taxonomy);
      await loadTaxonomy();
    });
    expect(seen.taxonomy).toBeNull();
  });

  it('labels directory roles from the API list or the built-in one', () => {
    expect(talentRoleLabel('PERFORMER', taxonomy)).toBe('Performers');
    expect(talentRoleLabel('live')).toBe('Live & touring crews');
    expect(talentRoleLabel('Tabla Player')).toBe('Tabla Player');
  });
});
