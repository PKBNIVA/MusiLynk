import { useEffect, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { errorMessage } from '../../lib/errors';
import { enablePush, getPushConfig, isSubscribedHere, pushSupport, type PushSupport } from '../../lib/push';

type Variant = 'hirer' | 'musician';

const COPY: Record<Variant, { title: string; body: string; cta: string }> = {
  hirer: {
    title: 'Get an alert the moment a musician responds',
    body: 'We’ll send a notification to this device as soon as someone says they can do it.',
    cta: 'Turn on alerts',
  },
  musician: {
    title: 'Get urgent gig alerts',
    body: 'Hear about matching “need someone by tomorrow” requests on this device, even when Verse is closed.',
    cta: 'Turn on alerts',
  },
};

const dismissKey = (variant: Variant) => `verse-push-dismissed-${variant}`;
const wasDismissed = (variant: Variant) => {
  try {
    return localStorage.getItem(dismissKey(variant)) === '1';
  } catch {
    return false;
  }
};

/**
 * A contextual invitation to turn on web push, shown only where the alert is the point: to a hirer
 * right after posting an urgent request, and to a musician on the urgent requests page. It renders
 * nothing when the server has push switched off, and never asks the browser for permission until
 * the button is pressed.
 */
export function PushOptIn({ variant, className = '' }: { variant: Variant; className?: string }) {
  const [state, setState] = useState<'checking' | 'hidden' | PushSupport>('checking');
  const [busy, setBusy] = useState(false);
  const copy = COPY[variant];

  useEffect(() => {
    let live = true;
    void (async () => {
      const config = await getPushConfig();
      if (!live) return;
      if (!config.enabled) return setState('hidden');
      const support = pushSupport();
      // Quietly show nothing to browsers with no push at all, and to people who already said no thanks here.
      if (support === 'unsupported' || (support === 'ready' && wasDismissed(variant))) return setState('hidden');
      if (support === 'ready' && (await isSubscribedHere())) return setState('hidden');
      if (live) setState(support);
    })();
    return () => {
      live = false;
    };
  }, [variant]);

  if (state === 'checking' || state === 'hidden' || state === 'unsupported') return null;

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === 'enabled') {
        toast.success('Alerts are on for this device');
        setState('hidden');
      } else if (result === 'denied') {
        setState('blocked');
      } else {
        setState('hidden');
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not turn on alerts. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(dismissKey(variant), '1');
    } catch {
      /* private mode: it just comes back next visit */
    }
    setState('hidden');
  }

  return (
    <section
      aria-label="Alerts"
      data-testid="push-opt-in"
      className={`rounded-xl border border-violet-400/25 bg-violet-500/10 p-4 flex gap-3 ${className}`}
    >
      {state === 'needs-install' ? (
        <Smartphone size={20} className="text-violet-300 mt-0.5 shrink-0" aria-hidden="true" />
      ) : (
        <BellRing size={20} className="text-violet-300 mt-0.5 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-white">{copy.title}</h2>
        {state === 'needs-install' ? (
          <p className="text-sm text-slate-300 mt-1">
            Add Verse to your home screen to get alerts. In Safari, tap Share, then “Add to Home Screen”, and open Verse
            from there.
          </p>
        ) : state === 'blocked' ? (
          <p className="text-sm text-slate-300 mt-1" role="status">
            Notifications are blocked for Verse in this browser. Allow them in your browser’s site settings, then come
            back to turn alerts on.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-300 mt-1">{copy.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void turnOn()} disabled={busy} aria-busy={busy}>
                {busy ? 'Turning on…' : copy.cta}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
                Not now
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
