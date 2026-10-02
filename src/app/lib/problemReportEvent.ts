// The one eager piece of "Report a problem": any screen calls openProblemReport() and the dialog
// is fetched and mounted on demand (see components/mountProblemReport.tsx). Keep this file tiny;
// it is in the entry chunk because the app error screen uses it.

export type OpenProblemReportOptions = {
  /** The error behind an error screen, so it is among the "recent errors" offered with the report. */
  error?: unknown;
  /** The signed-in role, to show what will be attached. */
  role?: string;
};

export function openProblemReport(options?: OpenProblemReportOptions) {
  void import('../components/mountProblemReport').then((m) => m.mountProblemReport(options));
}
