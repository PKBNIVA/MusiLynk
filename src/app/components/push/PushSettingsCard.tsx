import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { errorMessage } from '../../lib/errors';
import {
  disablePush,
  enablePush,
  getPushConfig,
  getPushPreferences,
  isSubscribedHere,
  pushSupport,
  savePushPreferences,
  type PushCategory,
  type PushPreferences,
  type PushSupport,
} from '../../lib/push';

const ROWS: { key: PushCategory; label: string; hint: string }[] = [
  {
    key: 'urgent',
    label: 'Urgent requests',
    hint: 'Matching “need someone by tomorrow” requests, and responses to yours.',
  },
  {
    key: 'messages',
    label: 'New messages',
    hint: 'Someone writes to you. The message itself is never shown on the lock screen.',
  },
  { key: 'bookings', label: 'Bookings', hint: 'A booking is confirmed or cancelled.' },
];

/** Account settings: push on/off for this device and the per-category toggles. Hidden when the server has push off. */
export function PushSettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [support, setSupport] = useState<PushSupport>('ready');
  const [here, setHere] = useState(false);
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const config = await getPushConfig();
      if (!live || !config.enabled) return;
      const [loaded, subscribed] = await Promise.all([getPushPreferences().catch(() => null), isSubscribedHere()]);
      if (!live || !loaded) return;
      setPrefs(loaded.preferences);
      setSupport(pushSupport());
      setHere(subscribed);
      setEnabled(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!enabled || !prefs) return null;

  async function toggleDevice() {
    if (busy) return;
    setBusy(true);
    try {
      if (here) {
        await disablePush();
        setHere(false);
        toast.success('Alerts are off for this device');
      } else {
        const result = await enablePush();
        setHere(result === 'enabled');
        setSupport(pushSupport());
        if (result === 'enabled') toast.success('Alerts are on for this device');
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not change alerts for this device.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: PushCategory, value: boolean) {
    if (saving || !prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSaving(key);
    try {
      const saved = await savePushPreferences({ [key]: value });
      setPrefs(saved.preferences);
    } catch (e: unknown) {
      setPrefs(previous);
      toast.error(errorMessage(e, 'Could not save this.'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10" data-testid="push-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing size={18} className="text-violet-300" />
          Push notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          {support === 'needs-install' ? (
            <p className="text-sm text-slate-300">
              Add Verse to your home screen to get alerts on this iPhone or iPad.
            </p>
          ) : support === 'unsupported' ? (
            <p className="text-sm text-slate-300">This browser can’t show push notifications.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-300" role="status">
                {here
                  ? 'Alerts are on for this device.'
                  : support === 'blocked'
                    ? 'Notifications are blocked for Verse in this browser. Allow them in your browser’s site settings.'
                    : 'Alerts are off for this device.'}
              </p>
              {support !== 'blocked' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void toggleDevice()}
                  disabled={busy}
                  aria-busy={busy}
                >
                  {here ? 'Turn off on this device' : 'Turn on for this device'}
                </Button>
              )}
            </div>
          )}
        </div>
        <ul className="space-y-4">
          {ROWS.map((row) => (
            <li key={row.key} className="flex items-start justify-between gap-4">
              <div>
                <label htmlFor={`push-${row.key}`} className="font-medium cursor-pointer">
                  {row.label}
                </label>
                <p id={`push-${row.key}-hint`} className="text-sm text-slate-400">
                  {row.hint}
                </p>
              </div>
              <Switch
                id={`push-${row.key}`}
                aria-describedby={`push-${row.key}-hint`}
                checked={prefs[row.key]}
                disabled={saving !== null}
                onCheckedChange={(v) => void toggle(row.key, v)}
                className="mt-1"
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">We never send promotions or marketing by push.</p>
      </CardContent>
    </Card>
  );
}
