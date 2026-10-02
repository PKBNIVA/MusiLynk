import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// public/sw.js is plain browser script, so run it against a small fake worker scope.
function loadWorker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: 'https://verse.example' },
    skipWaiting: () => {},
    registration: { showNotification: (title, options) => (shown.push({ title, options }), Promise.resolve()) },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url) => (opened.push(url), Promise.resolve()),
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  vm.runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), { self, URL });
  const waits = [];
  const fire = (type, event) => (listeners[type]({ ...event, waitUntil: (p) => waits.push(p) }), Promise.all(waits));
  return { fire, shown, opened };
}

const pushEvent = (payload) => ({ data: { json: () => payload } });

describe('public/sw.js', () => {
  it('shows a notification from the push payload and keeps the tapped URL', async () => {
    const { fire, shown } = loadWorker();
    await fire(
      'push',
      pushEvent({
        title: 'Urgent: Drummer needed in Pune',
        body: 'Tomorrow, 7 pm',
        url: '/jobseeker/urgent',
        tag: 'urgent-1',
      }),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Urgent: Drummer needed in Pune');
    expect(shown[0].options).toMatchObject({
      body: 'Tomorrow, 7 pm',
      tag: 'urgent-1',
      data: { url: 'https://verse.example/jobseeker/urgent' },
    });
  });

  it('still shows something for an empty or unreadable payload, and never links off-site', async () => {
    const { fire, shown } = loadWorker();
    await fire('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    await fire('push', pushEvent({ title: 'Hi', url: 'https://evil.example/phish' }));
    expect(shown[0].title).toBe('Verse');
    expect(shown[1].options.data.url).toBe('https://verse.example/');
  });

  it('focuses and navigates an open Verse window on click', async () => {
    const calls = [];
    const window = {
      url: 'https://verse.example/jobseeker',
      navigate: async (u) => (calls.push(['navigate', u]), window),
      focus: async () => calls.push(['focus']),
    };
    const { fire, opened } = loadWorker({ windows: [window] });
    await fire('notificationclick', {
      notification: {
        close: () => calls.push(['close']),
        data: { url: 'https://verse.example/employer/messages?c=1' },
      },
    });
    expect(calls).toEqual([['close'], ['navigate', 'https://verse.example/employer/messages?c=1'], ['focus']]);
    expect(opened).toEqual([]);
  });

  it('opens a new window on click when none is open', async () => {
    const { fire, opened } = loadWorker();
    await fire('notificationclick', {
      notification: { close: () => {}, data: { url: 'https://verse.example/jobseeker/urgent' } },
    });
    expect(opened).toEqual(['https://verse.example/jobseeker/urgent']);
  });
});
