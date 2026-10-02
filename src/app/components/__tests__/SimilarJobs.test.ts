import { describe, expect, it } from 'vitest';
import { pickSimilar } from '../SimilarJobs';
import type { Job } from '../../lib/apiTypes';

const job = (id: string, over: Partial<Job> = {}) =>
  ({ id, title: id, opportunity_kind: 'gig', location: 'Mumbai, Maharashtra', genre: 'Jazz', ...over }) as Job;

describe('pickSimilar', () => {
  const current = job('now');

  it('never lists the opportunity being read and stops at three', () => {
    const picked = pickSimilar(current, [job('now'), job('a'), job('b'), job('c'), job('d')]);
    expect(picked.map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the same kind, then the same city, then the same genre, keeping list order for ties', () => {
    const picked = pickSimilar(current, [
      job('other-city-other-genre', { location: 'Delhi', genre: 'Rock' }),
      job('same-genre', { location: 'Delhi', genre: 'Jazz' }),
      job('same-city', { genre: 'Rock' }),
      job('other-kind-same-city', { opportunity_kind: 'tour', location: 'Mumbai', genre: 'Rock' }),
    ]);
    expect(picked.map((j) => j.id)).toEqual(['same-city', 'same-genre', 'other-city-other-genre']);
  });

  it('is empty when nothing else is open', () => {
    expect(pickSimilar(current, [job('now')])).toEqual([]);
    expect(pickSimilar(current, [])).toEqual([]);
  });
});
