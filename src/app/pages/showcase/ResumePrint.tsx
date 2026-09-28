import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { usePageMeta } from '../../components/PageMeta';
import { useWorkspaceBase } from '../../components/showcase/parts';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/authContext';
import { errorMessage } from '../../lib/errors';
import { entryDetail, entryTitle, kindLabel, type Resume } from '../../lib/showcase';

/**
 * The resume laid out for paper: black on white, no navigation, one column. The browser's own
 * "Print → Save as PDF" makes the PDF; nothing is rendered on the server.
 */
export default function ResumePrint() {
  const { id = '' } = useParams();
  const base = useWorkspaceBase();
  const { user } = useAuth();
  const [resume, setResume] = useState<Resume | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    apiGet<{ resume: Resume }>(`/resumes/${encodeURIComponent(id)}`)
      .then((d) => setResume(d.resume))
      .catch((e: unknown) => setError(errorMessage(e, 'This resume could not be loaded.')));
  }, [id]);
  useEffect(load, [load]);
  usePageMeta(resume ? `${user?.name || 'Resume'} — ${resume.title}` : 'Resume');

  return (
    <div className="min-h-screen bg-slate-200 text-slate-900 print:bg-white">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-4 print:hidden">
        <Link
          to={`${base}/resumes/${id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-slate-700 hover:text-slate-950"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to the editor
        </Link>
        <Button
          onClick={() => window.print()}
          disabled={!resume}
          className="bg-slate-900 text-white hover:bg-slate-800"
        >
          <Printer size={16} aria-hidden="true" />
          Print or save as PDF
        </Button>
      </div>
      <main
        className="mx-auto mb-10 max-w-[210mm] bg-white px-6 py-8 shadow-xl sm:px-12 sm:py-12 print:m-0 print:max-w-none print:p-0 print:shadow-none"
        data-testid="resume-print"
      >
        {!resume ? (
          <p role={error ? 'alert' : 'status'} className="text-slate-700">
            {error || 'Loading…'}
          </p>
        ) : (
          <article>
            <header className="border-b-2 border-slate-900 pb-4">
              <h1 className="text-3xl font-bold tracking-tight">{user?.name || resume.title}</h1>
              {resume.headline && <p className="mt-1 text-lg text-slate-700">{resume.headline}</p>}
              {user?.email && <p className="mt-1 text-sm text-slate-700">{user.email}</p>}
            </header>
            {resume.summary && <p className="mt-5 whitespace-pre-line leading-7 text-slate-800">{resume.summary}</p>}
            {(resume.sections || []).map((section) => (
              <section key={section.kind} className="mt-6 break-inside-avoid">
                <h2 className="border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-widest text-slate-700">
                  {kindLabel(section.kind)}
                </h2>
                <ul className="mt-2 space-y-2">
                  {section.entries.map((entry) => (
                    <li key={entry.id} className="break-inside-avoid">
                      <p className="font-semibold">{entryTitle(entry)}</p>
                      {entryDetail(entry) && <p className="text-sm text-slate-700">{entryDetail(entry)}</p>}
                      {typeof entry.fields.description === 'string' && entry.fields.description && (
                        <p className="mt-0.5 text-sm leading-6 text-slate-700">{entry.fields.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {(resume.sections || []).length === 0 && (
              <p className="mt-6 text-slate-700">This resume has no entries yet.</p>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
