import {lazy, Suspense, useEffect, useState} from 'react';
import {PLAN_LIMIT_EVENT} from '../lib/api';

const PlanLimitDialog = lazy(() => import('./PlanLimitDialog'));

// App-wide upgrade prompt shown whenever the API refuses an action because of a plan limit
// (active opportunities, saved talent, booking enquiries, workspace seats). Only the event
// listener is loaded up front; the dialog loads the first time a limit is reached and then
// stays mounted so it can animate closed.
export function PlanLimitPrompt() {
  const [message, setMessage] = useState<string | null>(null);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    const onLimit = (event: Event) => {
      setMessage((event as CustomEvent).detail?.message || 'You have reached a limit of your current plan.');
      setNeeded(true);
    };
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);

  if (!needed) return null;
  return <Suspense fallback={null}><PlanLimitDialog message={message} onClose={() => setMessage(null)} /></Suspense>;
}
