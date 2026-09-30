import { describe, expect, it } from 'vitest';
import { personLines } from '../personLine';

describe('personLines', () => {
  it('uses the headline and drops what it already says', () => {
    expect(
      personLines({
        headline: 'FOH Engineer · Fusion & Rock',
        roles: ['FOH Engineer'],
        genres: ['Fusion', 'Rock'],
        location: 'Kochi',
      }),
    ).toEqual({ primary: 'FOH Engineer · Fusion & Rock', secondary: ['Kochi'] });
  });
  it('falls back to the roles when there is no headline', () => {
    expect(personLines({ roles: ['Singer', 'Composer'], genres: ['Pop'], location: 'Mumbai' })).toEqual({
      primary: 'Singer, Composer',
      secondary: ['Pop', 'Mumbai'],
    });
  });
  it('keeps partial overlaps, in roles, genres, location order', () => {
    expect(
      personLines({
        headline: 'Session guitarist',
        roles: ['Guitarist', 'Arranger'],
        genres: ['Jazz'],
        location: 'Goa',
      }),
    ).toEqual({
      primary: 'Session guitarist',
      secondary: ['Arranger', 'Jazz', 'Goa'],
    });
  });
  it('is empty for an empty person', () => {
    expect(personLines({})).toEqual({ primary: '', secondary: [] });
  });
});
