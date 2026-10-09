import { describe, expect, it } from 'vitest';
import { dropConfirmedPending, isPendingId, mergeMessages, newPendingId } from '../messageMerge';

const m = (id: string, createdAt: string, body = id) => ({ id, createdAt, body });

describe('mergeMessages', () => {
  it('keeps one copy of a message that arrives from a live update and a poll', () => {
    const live = mergeMessages([m('a', '1')], [m('b', '2')]);
    const polled = mergeMessages(live, [m('b', '2'), m('c', '3')]);
    expect(polled.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('lets the incoming copy win and drops duplicates inside one response', () => {
    const merged = mergeMessages([m('a', '1', 'old')], [m('a', '1', 'new'), m('a', '1', 'new')]);
    expect(merged).toEqual([m('a', '1', 'new')]);
  });

  it('orders by time, then id, whatever the arrival order', () => {
    expect(mergeMessages([m('z', '2')], [m('b', '1'), m('a', '2')]).map((x) => x.id)).toEqual(['b', 'a', 'z']);
  });
});

describe('optimistic messages', () => {
  const mine = (id: string, createdAt: string, body: string, extra = {}) => ({
    id,
    createdAt,
    body,
    senderId: 'me',
    ...extra,
  });

  it('shows a sent message once when the live copy lands before the POST reply', () => {
    const pending = mine('pending-1', '5', 'hello');
    const afterSocket = mergeMessages([pending], [mine('srv-9', '5', 'hello')]);
    expect(afterSocket.map((x) => x.id)).toEqual(['srv-9']);
    // The POST reply then removes nothing more and merges by id.
    expect(mergeMessages(afterSocket, [mine('srv-9', '5', 'hello')]).map((x) => x.id)).toEqual(['srv-9']);
  });

  it('matches by client nonce when both sides carry one, and only one bubble per real message', () => {
    const list = [
      mine('pending-a', '5', 'hi', { clientNonce: 'n1' }),
      mine('pending-b', '6', 'hi', { clientNonce: 'n2' }),
    ];
    expect(dropConfirmedPending(list, [mine('s1', '6', 'hi', { clientNonce: 'n2' })]).map((x) => x.id)).toEqual([
      'pending-a',
    ]);
    const same = [mine('pending-a', '5', 'hi'), mine('pending-b', '6', 'hi')];
    expect(dropConfirmedPending(same, [mine('s1', '6', 'hi')]).map((x) => x.id)).toEqual(['pending-b']);
  });

  it("keeps a pending bubble when the incoming message is someone else's or has another body", () => {
    const list = [mine('pending-1', '5', 'hello')];
    expect(dropConfirmedPending(list, [{ ...mine('s', '5', 'hello'), senderId: 'them' }])).toBe(list);
    expect(dropConfirmedPending(list, [mine('s', '5', 'other')])).toBe(list);
  });

  it('makes collision-free pending ids, with and without crypto.randomUUID', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPendingId()));
    expect(ids.size).toBe(200);
    ids.forEach((id) => expect(isPendingId(id)).toBe(true));
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const fallback = new Set(Array.from({ length: 200 }, () => newPendingId()));
      expect(fallback.size).toBe(200);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
