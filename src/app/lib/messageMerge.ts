/** Orders messages oldest first; ties by id, so the order never depends on arrival. */
export const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Adds `incoming` to `current` once each: a message that arrives twice (a live update and a poll
 * racing, or the sender's own copy) keeps one entry, and the incoming copy wins, so a later read
 * receipt or edit replaces the old one.
 */
export function mergeMessages<T extends MergeableMessage>(current: T[], incoming: T[]): T[] {
  const ids = new Set(incoming.map((m) => m.id));
  const unique = new Map<string, T>();
  incoming.forEach((m) => unique.set(m.id, m));
  return dropConfirmedPending([...current.filter((m) => !ids.has(m.id)), ...unique.values()].sort(byTime), incoming);
}

type MergeableMessage = { id: string; createdAt: string; senderId?: string; body?: string; clientNonce?: string };

/** Id prefix of a sent message the server has not confirmed yet (optimistic). */
export const PENDING_PREFIX = 'pending-';
export const isPendingId = (id: string) => id.startsWith(PENDING_PREFIX);

/** A collision-free id for an optimistic bubble (two sends in one millisecond, two tabs). */
export function newPendingId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `${PENDING_PREFIX}${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${PENDING_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}-${Date.now().toString(36)}`;
}

/**
 * An optimistic bubble whose real copy already arrived (a socket event or a poll landing before the POST
 * reply) is dropped: matched by client nonce when both carry one, else by sender + body, one bubble per
 * incoming message, oldest first. The POST reply then finds nothing left to remove and merges by id.
 */
export function dropConfirmedPending<T extends MergeableMessage>(list: T[], incoming: T[]): T[] {
  const real = incoming.filter((m) => !isPendingId(m.id));
  if (!real.length || !list.some((m) => isPendingId(m.id))) return list;
  const used = new Set<T>();
  const drop = new Set<string>();
  for (const pending of list) {
    if (!isPendingId(pending.id)) continue;
    const match = real.find(
      (m) =>
        !used.has(m) &&
        (pending.clientNonce && m.clientNonce
          ? pending.clientNonce === m.clientNonce
          : m.senderId !== undefined && m.senderId === pending.senderId && m.body === pending.body),
    );
    if (match) {
      used.add(match);
      drop.add(pending.id);
    }
  }
  return drop.size ? list.filter((m) => !drop.has(m.id)) : list;
}
