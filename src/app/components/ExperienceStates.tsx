import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { Button } from './ui/button';
import { reportError } from '../lib/monitoring';
import { openProblemReport } from '../lib/problemReportEvent';

export function PageLoading({ label = 'Preparing your MusiLynk workspace' }: { label?: string }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white grid place-items-center px-5" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto w-fit animate-pulse">
          <BrandMark />
        </div>
        <div className="mx-auto mt-6 h-1.5 w-52 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/3 animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400" />
        </div>
        <p className="mt-4 text-sm text-slate-400">{label}</p>
      </div>
    </div>
  );
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  lastError: unknown;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('MusiLynk screen error', error);
    this.lastError = error;
    reportError(error, { tags: { source: 'app_error_boundary' }, extra: { componentStack: info.componentStack } });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center px-5">
        <div className="musilynk-surface max-w-lg rounded-3xl p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/15 text-rose-300">
            <AlertTriangle />
          </span>
          <h1 className="mt-5 text-2xl font-black">This screen missed a beat.</h1>
          <p className="mt-3 text-slate-300">
            Your data is safe. Reload the page and MusiLynk will try the request again.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw size={16} className="mr-2" />
              Reload MusiLynk
            </Button>
            <Button variant="outline" onClick={() => openProblemReport({ error: this.lastError })}>
              Tell us what happened
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
