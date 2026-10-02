import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyStorage } from '../legacyStorage';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('migrateLegacyStorage', () => {
  it('moves a signed-in visitor token to the new key and removes the old one', () => {
    localStorage.setItem('verse_access_token', 'tok-1');
    migrateLegacyStorage();
    expect(localStorage.getItem('musilynk_access_token')).toBe('tok-1');
    expect(localStorage.getItem('verse_access_token')).toBeNull();
  });

  it('does not overwrite a key that already exists, but still drops the old one', () => {
    localStorage.setItem('verse_access_token', 'old');
    localStorage.setItem('musilynk_access_token', 'new');
    migrateLegacyStorage();
    expect(localStorage.getItem('musilynk_access_token')).toBe('new');
    expect(localStorage.getItem('verse_access_token')).toBeNull();
  });

  it('moves prefix keys for all three separators', () => {
    localStorage.setItem('verse_help_shown:x', '1');
    localStorage.setItem('verse:post-job:pay-mode:y', 'fixed');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    migrateLegacyStorage();
    expect(localStorage.getItem('musilynk_help_shown:x')).toBe('1');
    expect(localStorage.getItem('musilynk:post-job:pay-mode:y')).toBe('fixed');
    expect(localStorage.getItem('musilynk-tour-v2-jobseeker')).toBe('done');
    expect(localStorage.length).toBe(3);
  });

  it('moves session storage too and leaves unrelated keys alone', () => {
    sessionStorage.setItem('verse_return_to', '/jobs');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('universe_x', '1');
    migrateLegacyStorage();
    expect(sessionStorage.getItem('musilynk_return_to')).toBe('/jobs');
    expect(sessionStorage.getItem('verse_return_to')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('universe_x')).toBe('1');
  });

  it('is safe to run twice', () => {
    localStorage.setItem('verse_dnt', '1');
    migrateLegacyStorage();
    migrateLegacyStorage();
    expect(localStorage.getItem('musilynk_dnt')).toBe('1');
    expect(localStorage.length).toBe(1);
  });

  it('tolerates storage that throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    const blocked = {
      get localStorage(): Storage {
        return boom();
      },
      sessionStorage: {
        length: 1,
        key: boom,
        getItem: boom,
        setItem: boom,
        removeItem: boom,
      } as unknown as Storage,
    };
    expect(() => migrateLegacyStorage(blocked)).not.toThrow();
  });
});
