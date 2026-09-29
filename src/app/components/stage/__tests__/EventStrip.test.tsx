import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fetchUpcomingEventsMock } = vi.hoisted(() => ({ fetchUpcomingEventsMock: vi.fn() }));
vi.mock('../../../lib/stage', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/stage')>('../../../lib/stage');
  return { ...actual, fetchUpcomingEvents: fetchUpcomingEventsMock };
});

import { EventStrip } from '../EventStrip';
import type { StagePost } from '../../../lib/stage';

let container: HTMLDivElement;
let root: Root;

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  fetchUpcomingEventsMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function eventPost(id: string, title: string): StagePost {
  return {
    id,
    author: { type: 'user', id: 'u1', name: 'Someone', verified: true },
    kind: 'event',
    body: null,
    media: [],
    linkUrl: null,
    city: 'Mumbai',
    genres: [],
    hashtags: [],
    visibility: 'public',
    status: 'active',
    sharedEntity: null,
    applauseCount: 0,
    commentCount: 0,
    reshareCount: 0,
    applauded: false,
    pinned: false,
    pinnedUntil: null,
    event: { title, startsAt: '2026-10-05T13:00:00Z', venue: 'Blue Frog', city: 'Mumbai', link: null, featured: false },
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
  };
}

describe('EventStrip', () => {
  it('renders the next events for the viewer city once loaded', async () => {
    fetchUpcomingEventsMock.mockResolvedValue({ city: 'Mumbai', events: [eventPost('e1', 'Jam Night')] });
    render(<EventStrip />);
    await flush();

    expect(container.textContent).toContain('Upcoming in Mumbai');
    expect(container.textContent).toContain('Jam Night');
  });

  it('renders nothing when there are no upcoming events', async () => {
    fetchUpcomingEventsMock.mockResolvedValue({ city: 'Mumbai', events: [] });
    render(<EventStrip />);
    await flush();

    expect(container.textContent).toBe('');
  });

  it('renders nothing while the request fails', async () => {
    fetchUpcomingEventsMock.mockRejectedValue(new Error('network'));
    render(<EventStrip />);
    await flush();

    expect(container.textContent).toBe('');
  });
});
