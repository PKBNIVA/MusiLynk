// Core Web Vitals (LCP, INP, CLS) measured in real visitors' browsers.
//
// Dependency-free: uses the browser's PerformanceObserver directly, following the
// definitions at https://web.dev/articles/vitals. monitoring.ts starts this only when
// error monitoring is enabled (VITE_SENTRY_DSN), and each vital is reported at most once
// per page view, when the page is hidden (tab switch, navigation away or close).

export type VitalName = 'LCP' | 'INP' | 'CLS';
export type VitalRating = 'good' | 'needs-improvement' | 'poor';
export type Vital = { name: VitalName; value: number; rating: VitalRating };

// [good up to, poor above] as published for Core Web Vitals.
export const VITAL_THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
};

export function rateVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

type Shift = { value: number; startTime: number; hadRecentInput: boolean };

/**
 * CLS: layout shifts are grouped into session windows (shifts less than 1 s apart, a
 * window lasting at most 5 s); the score is the largest window. Shifts right after user
 * input are expected and ignored.
 */
export function clsFromShifts(shifts: Shift[]): number {
  let largest = 0;
  let current = 0;
  let windowStart = 0;
  let previous = 0;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    if (current > 0 && shift.startTime - previous < 1000 && shift.startTime - windowStart < 5000) {
      current += shift.value;
    } else {
      current = shift.value;
      windowStart = shift.startTime;
    }
    previous = shift.startTime;
    largest = Math.max(largest, current);
  }
  return largest;
}

/**
 * INP: the slowest interaction, ignoring one outlier for every 50 interactions (an
 * approximation of the 98th percentile). `durations` is the longest event per interaction.
 */
export function inpFromInteractions(durations: number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
}

type Reporter = (vital: Vital) => void;

/** Starts measuring; returns a function that stops without reporting. */
export function startWebVitals(report: Reporter): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return () => undefined;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  // A page opened in a background tab paints late for reasons unrelated to MusiLynk.
  const startedHidden = document.visibilityState === 'hidden';

  let lcp: number | null = null;
  let lcpFinal = false;
  const shifts: Shift[] = [];
  const interactions = new Map<number, number>();
  const observers: PerformanceObserver[] = [];

  const observe = (
    type: string,
    callback: (entries: PerformanceEntry[]) => void,
    options: Record<string, unknown> = {},
  ) => {
    if (!supported.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      /* unsupported option in this browser */
    }
  };

  observe('largest-contentful-paint', (entries) => {
    if (lcpFinal || startedHidden) return;
    const last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });
  observe('layout-shift', (entries) => {
    for (const entry of entries as unknown as Shift[])
      shifts.push({ value: entry.value, startTime: entry.startTime, hadRecentInput: entry.hadRecentInput });
  });
  const onInteractionEntries = (entries: PerformanceEntry[]) => {
    for (const entry of entries as unknown as Array<{ interactionId?: number; duration: number }>) {
      if (!entry.interactionId) continue;
      interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) || 0, entry.duration));
    }
  };
  observe('event', onInteractionEntries, { durationThreshold: 40 });
  observe('first-input', onInteractionEntries);

  // LCP stops at the first user input: later paints are caused by the visitor, not the load.
  const finalizeLcp = () => {
    lcpFinal = true;
  };
  window.addEventListener('keydown', finalizeLcp, { once: true, capture: true });
  window.addEventListener('pointerdown', finalizeLcp, { once: true, capture: true });

  let done = false;
  const stop = () => {
    done = true;
    for (const observer of observers) observer.disconnect();
    document.removeEventListener('visibilitychange', onHidden, true);
    window.removeEventListener('pagehide', flush, true);
    window.removeEventListener('keydown', finalizeLcp, true);
    window.removeEventListener('pointerdown', finalizeLcp, true);
  };
  function flush() {
    if (done) return;
    for (const observer of observers) {
      // Deliver anything the browser has queued but not yet dispatched.
      const pending = observer.takeRecords?.() || [];
      if (pending.length) onPending(pending);
    }
    stop();
    const vitals: Vital[] = [];
    if (lcp !== null) vitals.push({ name: 'LCP', value: Math.round(lcp), rating: rateVital('LCP', lcp) });
    const inp = inpFromInteractions([...interactions.values()]);
    if (inp !== null) vitals.push({ name: 'INP', value: Math.round(inp), rating: rateVital('INP', inp) });
    if (supported.includes('layout-shift')) {
      const cls = Number(clsFromShifts(shifts).toFixed(4));
      vitals.push({ name: 'CLS', value: cls, rating: rateVital('CLS', cls) });
    }
    for (const vital of vitals) {
      try {
        report(vital);
      } catch {
        /* reporting must never break the page */
      }
    }
  }
  function onPending(entries: PerformanceEntry[]) {
    for (const entry of entries) {
      if (entry.entryType === 'largest-contentful-paint' && !lcpFinal && !startedHidden) lcp = entry.startTime;
      else if (entry.entryType === 'layout-shift') {
        const shift = entry as unknown as Shift;
        shifts.push({ value: shift.value, startTime: shift.startTime, hadRecentInput: shift.hadRecentInput });
      } else onInteractionEntries([entry]);
    }
  }
  function onHidden() {
    if (document.visibilityState === 'hidden') flush();
  }
  document.addEventListener('visibilitychange', onHidden, true);
  window.addEventListener('pagehide', flush, true);
  return stop;
}
