import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPut } from '../lib/api';
import { errorMessage } from '../lib/errors';

/** "Email me when payments open": the one preference behind the payments-open-soon notices. */
export function PaymentsNotify() {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiGet<{ paymentsNotify?: boolean }>('/notifications/preferences')
      .then((d) => setOn(d.paymentsNotify === true))
      .catch(() => setOn(null));
  }, []);
  if (on === null) return null;
  async function change(next: boolean) {
    if (saving) return;
    setOn(next);
    setSaving(true);
    try {
      await apiPut('/me/email-preferences', { emailPreferences: { paymentsNotify: next } });
      toast.success(next ? 'We’ll email you when payments open.' : 'We won’t email you about payments.');
    } catch (e: unknown) {
      setOn(!next);
      toast.error(errorMessage(e, 'Unable to save this preference.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-violet-500"
        checked={on}
        disabled={saving}
        onChange={(e) => void change(e.target.checked)}
        data-testid="payments-notify"
      />
      Email me when payments open
    </label>
  );
}
