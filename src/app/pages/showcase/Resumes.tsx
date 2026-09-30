import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { BookOpenCheck, Plus, Printer, ScrollText, Star } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Field } from '../../components/form/Field';
import { EmptyState } from '../../components/kit/EmptyState';
import { LoadState, Panel, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { RulesSentence } from '../../components/showcase/RulesEditor';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import type { CareerEntry, Resume } from '../../lib/showcase';

export default function Resumes() {
  const base = useWorkspaceBase();
  const nav = useNavigate();
  const [list, setList] = useState<Resume[] | null>(null);
  const [entryCount, setEntryCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [titleError, setTitleError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    apiGet<{ resumes?: Resume[] }>('/resumes')
      .then((d) => setList(d.resumes || []))
      .catch((e: unknown) => setError(errorMessage(e, 'Your resumes could not be loaded.')));
    apiGet<{ entries?: CareerEntry[] }>('/career-entries')
      .then((d) => setEntryCount((d.entries || []).length))
      .catch(() => setEntryCount(null));
  }, []);
  useEffect(load, [load]);

  async function create() {
    if (!title.trim()) {
      setTitleError('Name this resume, for example “Session CV”.');
      document.getElementById('resume-title')?.focus();
      return;
    }
    setBusy(true);
    try {
      const out = await apiPost<{ id: string; resume: Resume }>('/resumes', {
        title: title.trim(),
        targetRole: role.trim() || undefined,
      });
      toast.success('Resume created from your whole career record');
      nav(`${base}/resumes/${out.id || out.resume.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'The resume could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(r: Resume) {
    try {
      await apiPost(`/resumes/${r.id}/default`);
      setList((l) => (l || []).map((x) => ({ ...x, isDefault: x.id === r.id })));
      toast.success(`“${r.title}” is now your default`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <ShowcaseShell
      title="Resumes"
      help={SHOWCASE_HELP.resumes}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to={`${base}/career`}>
              <BookOpenCheck size={16} aria-hidden="true" />
              Career record{entryCount !== null ? ` (${entryCount})` : ''}
            </Link>
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New resume
          </Button>
        </>
      }
    >
      {creating && (
        <Panel title="New resume" icon={Plus} className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="resume-title" label="Name" required error={titleError}>
              <Input
                value={title}
                maxLength={120}
                onChange={(e) => (setTitle(e.target.value), setTitleError(''))}
                placeholder="Session CV"
                className="border-white/15 bg-black/20"
              />
            </Field>
            <Field id="resume-role" label="Aimed at" optional hint="The kind of work this resume is for.">
              <Input
                value={role}
                maxLength={120}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Session keys"
                className="border-white/15 bg-black/20"
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void create()} disabled={busy}>
              Create resume
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}
      {entryCount === 0 && (
        <EmptyState
          icon={BookOpenCheck}
          className="mb-6"
          title="Start with your career record"
          action={
            <Button asChild>
              <Link to={`${base}/career`}>Fill in my career record</Link>
            </Button>
          }
        >
          Resumes are built from it, so there’s nothing to show until it has a few entries.
        </EmptyState>
      )}
      {list === null ? (
        <LoadState error={error} onRetry={load} />
      ) : list.length === 0 ? (
        !creating && (
          <EmptyState
            icon={ScrollText}
            title="No resumes yet"
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" />
                New resume
              </Button>
            }
          >
            A new resume starts with your whole record; narrow it for the work you want.
          </EmptyState>
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex flex-col rounded-2xl border border-white/10 bg-white/[.055] p-5"
              data-testid="resume-card"
            >
              {r.isDefault && (
                <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                  <Star size={12} aria-hidden="true" />
                  Default
                </span>
              )}
              <h2 className="text-xl font-semibold break-words">
                <Link to={`${base}/resumes/${r.id}`} className="hover:underline">
                  {r.title}
                </Link>
              </h2>
              {r.targetRole && <p className="text-sm text-violet-200">For {r.targetRole}</p>}
              <RulesSentence rules={r.rules} subject="record" className="mt-1 text-sm text-slate-400" />
              <p className="mt-2 text-sm text-slate-300">
                {r.entryCount ?? 0} entr{r.entryCount === 1 ? 'y' : 'ies'}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Button size="sm" asChild>
                  <Link to={`${base}/resumes/${r.id}`}>
                    Edit<span className="sr-only"> {r.title}</span>
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`${base}/resumes/${r.id}/print`}>
                    <Printer size={14} aria-hidden="true" />
                    Print<span className="sr-only"> {r.title}</span>
                  </Link>
                </Button>
                {!r.isDefault && (
                  <Button size="sm" variant="ghost" onClick={() => void makeDefault(r)}>
                    Set as default<span className="sr-only">: {r.title}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ShowcaseShell>
  );
}
