import { describe, expect, it } from 'vitest';
import { checkPasswordStrength, PASSWORD_MIN_LENGTH } from '../passwordStrength';

describe('checkPasswordStrength', () => {
  it('flags a password shorter than the minimum length', () => {
    const result = checkPasswordStrength('short1');
    expect(result.minLength).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('accepts a password at exactly the minimum length', () => {
    expect(checkPasswordStrength('a'.repeat(PASSWORD_MIN_LENGTH)).minLength).toBe(true);
  });

  it('flags a commonly used password (case-insensitive)', () => {
    expect(checkPasswordStrength('Password123').notCommon).toBe(false);
    expect(checkPasswordStrength('password123').notCommon).toBe(false);
  });

  it('flags a password containing the email local part', () => {
    const result = checkPasswordStrength('mayarocks2024', 'maya@example.com');
    expect(result.notIdentity).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('flags a password containing part of the display name', () => {
    const result = checkPasswordStrength('greatgatsby99', '', 'Gatsby Great');
    expect(result.notIdentity).toBe(false);
  });

  it('ignores identity fragments shorter than three characters', () => {
    // A two-letter local part ("jo") should never itself disqualify a password.
    const result = checkPasswordStrength('LongEnoughPass1', 'jo@example.com');
    expect(result.notIdentity).toBe(true);
  });

  it('accepts a strong, uncommon, non-identifying password', () => {
    const result = checkPasswordStrength('Zx7#quietOrbit42', 'someone@example.com', 'Someone Else');
    expect(result).toEqual({ minLength: true, notCommon: true, notIdentity: true, valid: true });
  });

  it('treats an empty password as invalid without throwing', () => {
    expect(checkPasswordStrength('').valid).toBe(false);
  });
});
