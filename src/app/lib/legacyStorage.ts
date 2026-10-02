/**
 * One-time move of browser storage from the old product name to MusiLynk, run before anything
 * reads storage. A value is copied only when the new key is still empty, then the old key is
 * removed, so a signed-in visitor stays signed in and drafts survive. Safe to run on every load.
 */
const PREFIX_MOVES: ReadonlyArray<readonly [string, string]> = [
  ['verse_', 'musilynk_'],
  ['verse-', 'musilynk-'],
  ['verse:', 'musilynk:'],
];

function moveIn(store: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    const move = PREFIX_MOVES.find(([from]) => key.startsWith(from));
    if (!move) continue;
    const next = move[1] + key.slice(move[0].length);
    const value = store.getItem(key);
    if (value !== null && store.getItem(next) === null) store.setItem(next, value);
    store.removeItem(key);
  }
}

export function migrateLegacyStorage(win: Pick<Window, 'localStorage' | 'sessionStorage'> = window) {
  for (const pick of [() => win.localStorage, () => win.sessionStorage]) {
    try {
      moveIn(pick());
    } catch {
      // Storage blocked (private mode, disabled cookies): nothing to move.
    }
  }
}
