import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clsFromShifts, inpFromInteractions, rateVital, startWebVitals, type Vital } from '../webVitals';

type Entry = Record<string, unknown>;

/** PerformanceObserver stand-in: tests emit entries per type and queue records for takeRecords(). */
class FakeObserver {
  static supportedEntryTypes: string[] = ['largest-contentful-paint', 'layout-shift', 'event', 'first-input'];
  static instances: FakeObserver[] = [];
  static failOn = new Set<string>();
  type = '';
  disconnected = false;
  pending: Entry[] = [];
  constructor(private callback: (list: { getEntries: () => Entry[] }) => void) {
    FakeObserver.instances.push(this);
  }
  observe(options: { type: string }) {
    if (FakeObserver.failOn.has(options.type)) throw new TypeError('unsupported option');
    this.type = options.type;
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    const records = this.pending;
    this.pending = [];
    return records;
  }
  emit(entries: Entry[]) {
    this.callback({ getEntries: () => entries.map((entry) => ({ entryType: this.type, ...entry })) });
  }
  queue(entries: Entry[]) {
    this.pending.push(...entries.map((entry) => ({ entryType: this.type, ...entry })));
  }
  static of(type: string) {
    return FakeObserver.instances.find((o) => o.type === type)!;
  }
}

let visibility: DocumentVisibilityState = 'visible';

function hide() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}

function start(report = vi.fn<(vital: Vital) => void>()) {
  const stop = startWebVitals(report);
  return { report, stop };
}

beforeEach(() => {
  FakeObserver.instances = [];
  FakeObserver.failOn = new Set();
  FakeObserver.supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event', 'first-input'];
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('PerformanceObserver', FakeObserver);
});

afterEach(() => {
  // Leaves no listener behind for the next test.
  window.dispatchEvent(new Event('pagehide'));
});

describe('rateVital', () => {
  it('uses the published good / poor thresholds', () => {
    expect(rateVital('LCP', 2500)).toBe('good');
    expect(rateVital('LCP', 2501)).toBe('needs-improvement');
    expect(rateVital('LCP', 4001)).toBe('poor');
    expect(rateVital('INP', 200)).toBe('good');
    expect(rateVital('INP', 501)).toBe('poor');
    expect(rateVital('CLS', 0.1)).toBe('good');
    expect(rateVital('CLS', 0.2)).toBe('needs-improvement');
  });
});

describe('clsFromShifts', () => {
  const shift = (startTime: number, value: number, hadRecentInput = false) => ({ startTime, value, hadRecentInput });

  it('takes the largest session window', () => {
    expect(clsFromShifts([])).toBe(0);
    expect(clsFromShifts([shift(0, 0.1), shift(500, 0.05), shift(2600, 0.12)])).toBeCloseTo(0.15);
  });

  it('closes a window after five seconds and ignores shifts after input', () => {
    expect(clsFromShifts([0, 900, 1800, 2700, 3600, 4500, 5400].map((t) => shift(t, 0.02)))).toBeCloseTo(0.12);
    expect(clsFromShifts([shift(0, 0.5, true), shift(100, 0.01)])).toBe(0.01);
  });
});

describe('inpFromInteractions', () => {
  it('returns the slowest interaction, ignoring one outlier per fifty', () => {
    expect(inpFromInteractions([])).toBeNull();
    expect(inpFromInteractions([40, 300, 120])).toBe(300);
    expect(inpFromInteractions(Array.from({ length: 120 }, (_, i) => i + 1))).toBe(118);
  });
});

describe('startWebVitals', () => {
  it('reports LCP, INP and CLS once, when the page is hidden', () => {
    const { report } = start();
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 1200 }, { startTime: 3100 }]);
    FakeObserver.of('largest-contentful-paint').emit([]);
    FakeObserver.of('layout-shift').emit([{ startTime: 10, value: 0.3, hadRecentInput: false }]);
    FakeObserver.of('event').emit([
      { interactionId: 7, duration: 90 },
      { interactionId: 7, duration: 260 },
      { interactionId: 0, duration: 999 },
    ]);
    FakeObserver.of('first-input').emit([{ interactionId: 8, duration: 30 }]);
    window.dispatchEvent(new Event('pointerdown'));
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 9000 }]); // after input: ignored

    document.dispatchEvent(new Event('visibilitychange')); // still visible: nothing yet
    expect(report).not.toHaveBeenCalled();

    hide();
    expect(report.mock.calls.map((call) => call[0])).toEqual([
      { name: 'LCP', value: 3100, rating: 'needs-improvement' },
      { name: 'INP', value: 260, rating: 'needs-improvement' },
      { name: 'CLS', value: 0.3, rating: 'poor' },
    ]);
    expect(FakeObserver.instances.every((o) => o.disconnected)).toBe(true);

    window.dispatchEvent(new Event('pagehide'));
    hide();
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('includes entries the browser queued but had not dispatched yet', () => {
    const { report } = start();
    FakeObserver.of('largest-contentful-paint').queue([{ startTime: 1800 }]);
    FakeObserver.of('layout-shift').queue([{ startTime: 5, value: 0.05, hadRecentInput: false }]);
    FakeObserver.of('event').queue([{ interactionId: 3, duration: 120 }]);
    window.dispatchEvent(new Event('pagehide'));
    expect(report.mock.calls.map((call) => call[0])).toEqual([
      { name: 'LCP', value: 1800, rating: 'good' },
      { name: 'INP', value: 120, rating: 'good' },
      { name: 'CLS', value: 0.05, rating: 'good' },
    ]);
  });

  it('skips LCP for pages opened in the background and after the first key press', () => {
    visibility = 'hidden';
    const background = start();
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 5000 }]);
    FakeObserver.of('largest-contentful-paint').queue([{ startTime: 6000 }]);
    window.dispatchEvent(new Event('pagehide'));
    expect(background.report.mock.calls.map((call) => call[0].name)).toEqual(['CLS']);

    visibility = 'visible';
    FakeObserver.instances = [];
    const typed = start();
    window.dispatchEvent(new Event('keydown'));
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 700 }]);
    FakeObserver.of('largest-contentful-paint').queue([{ startTime: 800 }]);
    hide();
    expect(typed.report.mock.calls.map((call) => call[0].name)).toEqual(['CLS']);
  });

  it('reports only what the browser supports and survives observer and reporter errors', () => {
    FakeObserver.supportedEntryTypes = ['largest-contentful-paint', 'event'];
    FakeObserver.failOn = new Set(['event']);
    const report = vi.fn(() => {
      throw new Error('reporter broke');
    });
    start(report);
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 900 }]);
    expect(() => hide()).not.toThrow();
    expect(report.mock.calls.map((call) => (call as unknown as [Vital])[0].name)).toEqual(['LCP']);
  });

  it('tolerates an observer without takeRecords, and a browser without the list of types', () => {
    const plain = class extends FakeObserver {};
    Object.defineProperty(plain.prototype, 'takeRecords', { value: undefined });
    Object.defineProperty(plain, 'supportedEntryTypes', { value: undefined });
    vi.stubGlobal('PerformanceObserver', plain);
    const { report } = start();
    expect(FakeObserver.instances).toHaveLength(0);
    hide();
    expect(report).not.toHaveBeenCalled();

    vi.stubGlobal('PerformanceObserver', class extends FakeObserver {});
    Object.defineProperty(PerformanceObserver.prototype, 'takeRecords', { configurable: true, value: undefined });
    visibility = 'visible';
    const second = start();
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 400 }]);
    hide();
    expect(second.report.mock.calls.map((call) => call[0].name)).toEqual(['LCP', 'CLS']);
  });

  it('stops without reporting, and does nothing where PerformanceObserver is missing', () => {
    const { report, stop } = start();
    FakeObserver.of('largest-contentful-paint').emit([{ startTime: 400 }]);
    stop();
    hide();
    expect(report).not.toHaveBeenCalled();

    vi.stubGlobal('PerformanceObserver', undefined);
    const missing = start();
    expect(() => missing.stop()).not.toThrow();
    hide();
    expect(missing.report).not.toHaveBeenCalled();
  });
});
