import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import { PublicNav } from '../components/PublicNav';
import { apiGet } from '../lib/api';
import { CheckCircle2, XCircle } from 'lucide-react';

// The one-click link from the expiry-warning email: .../urgent/:id?action=filled|close&t=...
// The token (not the "action" query param) is the actual authorization — see
// UrgentRequestsController#action_from_token, which reads the action from the signed token.
export default function UrgentAction() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = params.get('t');
    if (!id || !t) {
      setState('error');
      return;
    }
    apiGet<{ ok: boolean; status: string }>(
      `/urgent-requests/${encodeURIComponent(id)}/token-action?t=${encodeURIComponent(t)}`,
    )
      .then((d) => {
        setStatus(d.status);
        setState('done');
      })
      .catch(() => setState('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-lg mx-auto px-5 pt-32 pb-16 text-center">
        {state === 'loading' && <p className="text-slate-400">Updating your request…</p>}
        {state === 'done' && (
          <>
            <CheckCircle2 className="mx-auto text-emerald-300" size={40} />
            <h1 className="text-2xl font-semibold mt-4">{status === 'filled' ? 'Marked filled' : 'Request closed'}</h1>
            <p className="text-slate-400 mt-2">
              {status === 'filled'
                ? "Thanks — we've let the request page know."
                : 'This request no longer appears to musicians.'}
            </p>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle className="mx-auto text-rose-300" size={40} />
            <h1 className="text-2xl font-semibold mt-4">This link has expired or is invalid</h1>
            <p className="text-slate-400 mt-2">You can manage this request directly instead.</p>
          </>
        )}
        <Link to="/jobseeker/urgent" className="text-violet-300 underline mt-6 inline-block">
          Go to urgent requests
        </Link>
      </main>
    </div>
  );
}
