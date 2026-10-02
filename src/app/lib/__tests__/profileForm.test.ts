import { describe, expect, it } from 'vitest';
import { normalizeWebAddress } from '../profileForm';

describe('normalizeWebAddress', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  www.example.com/showreel?x=1 ', 'https://www.example.com/showreel?x=1'],
    ['//example.com', 'https://example.com'],
    ['youtube.com/@asha', 'https://youtube.com/@asha'],
  ])('adds https:// to %s', (raw, expected) => {
    expect(normalizeWebAddress(raw)).toBe(expected);
  });

  it.each(['https://example.com', 'http://example.com', 'javascript:alert(1)', 'mailto:a@b.co'])(
    'leaves %s for the validator',
    (raw) => {
      expect(normalizeWebAddress(raw)).toBe(raw);
    },
  );

  it.each(['not a url', 'abc', 'localhost'])('leaves %s alone so it still fails validation', (raw) => {
    expect(normalizeWebAddress(raw)).toBe(raw);
  });

  it('turns blank into blank', () => {
    expect(normalizeWebAddress('   ')).toBe('');
  });
});
