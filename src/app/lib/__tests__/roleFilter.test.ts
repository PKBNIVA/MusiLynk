import { describe, expect, it } from 'vitest';
import { hasRole, joinRoles, roleChips, splitRoles, toggleRole } from '../roleFilter';

describe('roleFilter', () => {
  it('splits, trims and drops blank and repeated roles', () => {
    expect(splitRoles('')).toEqual([]);
    expect(splitRoles(' Drummer , ,vocalist,Drummer,Sound  engineer')).toEqual([
      'Drummer',
      'vocalist',
      'Sound engineer',
    ]);
  });

  it('joins roles without stray commas', () => {
    expect(joinRoles(['Drummer', 'Lead, vocalist', ''])).toBe('Drummer,Lead vocalist');
    expect(joinRoles([])).toBe('');
  });

  it('knows whether a role is selected, ignoring case', () => {
    expect(hasRole('Drummer,Vocalist', 'vocalist')).toBe(true);
    expect(hasRole('Drummer', 'Pianist')).toBe(false);
  });

  it('toggles a role off and on, keeping the others', () => {
    expect(toggleRole('Drummer,Vocalist', 'drummer')).toBe('Vocalist');
    expect(toggleRole('Vocalist', 'Drummer')).toBe('Vocalist,Drummer');
    expect(toggleRole('Drummer', 'Drummer')).toBe('');
  });

  it('lists the own roles first, then selected roles from a shared link', () => {
    expect(roleChips(['Drummer', 'Vocalist'], 'vocalist,Pianist')).toEqual(['Drummer', 'Vocalist', 'Pianist']);
    expect(roleChips([], '')).toEqual([]);
  });
});
