import { useEffect, useState } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { apiGet, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { HeartHandshake } from 'lucide-react';
import type { Vouch } from '../lib/apiTypes';

const MAX_VOUCHES = 3;

/** "Vouch for a musician you've worked with" — visible only to verified musicians (see
 * VouchesController; the backend enforces the cap and the verified-only rule too). */
export function VouchCard() {
  const [vouches, setVouches] = useState<Vouch[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiGet<{ vouches?: Vouch[] }>('/vouches')
      .then((d) => setVouches(d.vouches || []))
      .finally(() => setLoaded(true));
  }, []);

  async function submit() {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const { vouch } = await apiPost<{ vouch: Vouch }>('/vouches', { email: email.trim() });
      setVouches((current) => [vouch, ...current]);
      setEmail('');
      toast.success('Invite sent');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to send this vouch.'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  const slotsUsed = vouches.length;
  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <HeartHandshake size={18} className="text-violet-300" />
          <h2 className="font-semibold">Vouch for a musician you've worked with</h2>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Verified musicians get reviewed first. No money involved — just a referral.
        </p>
        <div className="flex items-center gap-1.5 mt-3" aria-label={`${slotsUsed} of ${MAX_VOUCHES} vouches used`}>
          {Array.from({ length: MAX_VOUCHES }, (_, i) => (
            <span key={i} className={`h-2 w-8 rounded-full ${i < slotsUsed ? 'bg-violet-400' : 'bg-white/10'}`} />
          ))}
          <span className="text-xs text-slate-500 ml-2">
            {slotsUsed}/{MAX_VOUCHES} used
          </span>
        </div>
        {slotsUsed < MAX_VOUCHES && (
          <div className="flex gap-2 mt-4">
            <Input
              type="email"
              placeholder="their-email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/5 border-white/15"
            />
            <Button onClick={submit} disabled={busy || !email.trim()}>
              Vouch
            </Button>
          </div>
        )}
        {vouches.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {vouches.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-300 truncate">{v.vouchee_email}</span>
                <Badge variant="secondary" className="capitalize">
                  {v.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
