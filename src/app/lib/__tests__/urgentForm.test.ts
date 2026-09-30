import { describe, expect, it } from 'vitest';
import {
  BUDGET_BANDS,
  defaultStartAt,
  emptyUrgentValues,
  urgentBody,
  urgentSummary,
  validateUrgent,
  type UrgentFormValues,
} from '../urgentForm';

const now = new Date('2026-10-01T10:00:00').getTime();
const filled = (overrides: Partial<UrgentFormValues> = {}): UrgentFormValues => ({
  ...emptyUrgentValues({ role: 'Drummer', city: 'Pune' }),
  startAt: '2026-10-02T18:00',
  budget: '5k-10k',
  note: 'Two sets, gear provided.',
  ...overrides,
});

describe('defaultStartAt', () => {
  it('is tomorrow at 6pm local, as a datetime-local value', () => {
    expect(defaultStartAt(new Date('2026-10-01T09:15:00'))).toBe('2026-10-02T18:00');
  });
});

describe('validateUrgent', () => {
  it('accepts the five required answers', () => {
    expect(validateUrgent(filled(), now)).toEqual({});
  });

  it('names every missing answer at once', () => {
    const errors = validateUrgent(filled({ role: [], city: [''], budget: '', note: '  ' }), now);
    expect(Object.keys(errors).sort()).toEqual(['budget', 'city', 'note', 'role']);
    expect(urgentSummary(errors)).toBe('Check the role, city, budget and a short note before posting.');
  });

  it('rejects a start that has passed and an end that is not after the start', () => {
    expect(validateUrgent(filled({ startAt: '2026-09-30T18:00' }), now).startAt).toMatch(/already passed/);
    expect(validateUrgent(filled({ endAt: '2026-10-02T17:00' }), now).endAt).toMatch(/after the start/);
  });

  it('has no summary when nothing is wrong', () => {
    expect(urgentSummary({})).toBe('');
  });
});

describe('urgentBody', () => {
  it('titles the request from the role and city and turns the band into a min and max', () => {
    const body = urgentBody(filled({ venue: ' Blue Frog ', instrument: 'Drums', genres: ['Rock', 'Funk'] }));
    expect(body).toMatchObject({
      title: 'Drummer needed in Pune',
      roleName: 'Drummer',
      city: 'Pune',
      budgetMin: 5000,
      budgetMax: 10000,
      note: 'Two sets, gear provided.',
      venue: 'Blue Frog',
      instrument: 'Drums',
      genre: 'Rock, Funk',
      endAt: null,
      requirements: null,
    });
    expect(body.startAt).toBe(new Date('2026-10-02T18:00').toISOString());
  });

  it('leaves the top band open-ended', () => {
    const top = BUDGET_BANDS.at(-1)!;
    expect(urgentBody(filled({ budget: top.value }))).toMatchObject({ budgetMin: 50000, budgetMax: null });
  });
});
