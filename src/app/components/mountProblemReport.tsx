import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
// A dynamic import of its own, so the entry chunk's preload table lists only this small file.
const ProblemReportDialog = lazy(() => import('./ProblemReportDialog'));
import { noteClientError } from '../lib/recentErrors';
import type { OpenProblemReportOptions } from '../lib/problemReportEvent';

// Shows the dialog in a root of its own, so it works from anywhere, including the app error screen
// where the rest of the app is gone. One at a time; the root is removed once the dialog has closed.
let active = false;

function Mounted({ role, onDone }: { role?: string; onDone: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Suspense fallback={null}>
      <ProblemReportDialog
        open={open}
        role={role}
        onOpenChange={(next) => {
          setOpen(next);
          // After the close animation, so focus can return to what opened it.
          if (!next) window.setTimeout(onDone, 300);
        }}
      />
    </Suspense>
  );
}

export function mountProblemReport(options?: OpenProblemReportOptions) {
  if (active) return;
  active = true;
  if (options?.error !== undefined) noteClientError(options.error);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <Mounted
      role={options?.role}
      onDone={() => {
        root.unmount();
        host.remove();
        active = false;
      }}
    />,
  );
}
