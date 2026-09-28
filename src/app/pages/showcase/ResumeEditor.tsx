import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Filter,
  ListOrdered,
  Pencil,
  Printer,
  ScrollText,
  Settings2,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { AiSuggestButton } from '../../components/ai/AiSuggestButton';
import {
  LoadState,
  Panel,
  ShowcaseShell,
  StateActions,
  StateBadge,
  useWorkspaceBase,
} from '../../components/showcase/parts';
import { ResumeRulesEditor, RulesSentence } from '../../components/showcase/RulesEditor';
import { InheritedField } from '../../components/showcase/InheritedField';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import {
  cleanRules,
  entryDetail,
  entryMatches,
  entryTitle,
  fullSectionOrder,
  isOverridden,
  itemState,
  kindLabel,
  move,
  type CareerEntry,
  type Resume,
  type Rules,
} from '../../lib/showcase';

export default function ResumeEditor() {
  const { id = '' } = useParams();
  const base = useWorkspaceBase();
  const nav = useNavigate();
  const [resume, setResume] = useState<Resume | null>(null);
  const [entries, setEntries] = useState<CareerEntry[]>([]);
  const [error, setError] = useState('');
  const [rules, setRules] = useState<Rules>({});
  const [editingRules, setEditingRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ title: string; targetRole: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accept = useCallback((r: Resume) => {
    setResume(r);
    setRules(r.rules || {});
  }, []);
  const path = `/resumes/${encodeURIComponent(id)}`;
  const load = useCallback(() => {
    setError('');
    apiGet<{ resume: Resume }>(path)
      .then((d) => accept(d.resume))
      .catch((e: unknown) => setError(errorMessage(e, 'This resume could not be loaded.')));
    apiGet<{ entries?: CareerEntry[] }>('/career-entries')
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]));
  }, [path, accept]);
  useEffect(load, [load]);

  async function run(action: () => Promise<{ resume: Resume }>, done?: string) {
    setBusy(true);
    try {
      accept((await action()).resume);
      if (done) toast.success(done);
      return true;
    } catch (e: unknown) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const patch = (body: Record<string, unknown>, done?: string) => run(() => apiPatch(path, body), done);

  if (!resume)
    return (
      <ShowcaseShell title="Resume" back={{ to: `${base}/resumes`, label: 'All resumes' }}>
        <LoadState error={error} onRetry={load} />
      </ShowcaseShell>
    );

  const order = fullSectionOrder(resume.sectionOrder);
  const pinned = resume.pinnedEntryIds || [];
  const excluded = resume.excludedEntryIds || [];
  const rulesDirty = JSON.stringify(cleanRules(rules)) !== JSON.stringify(cleanRules(resume.rules || {}));
  const summaryField = (field: 'headline' | 'summary', label: string) => (
    <InheritedField
      id={`resume-${field}`}
      label={label}
      kind={field === 'summary' ? 'textarea' : 'text'}
      value={resume[field]}
      master={resume.master?.[field]}
      overridden={isOverridden(resume, field)}
      busy={busy}
      onSave={(value) => patch({ [field]: value }, `${label} saved for this resume`)}
      onReset={() => run(() => apiPost(`${path}/reset`, { fields: [field] }), 'Back to your profile’s version')}
      ai={
        field === 'summary'
          ? (draft, set) => (
              <AiSuggestButton
                task="resume_summary"
                value={draft}
                getContext={() => ({
                  roles: [resume.targetRole || ''].filter(Boolean),
                  skills: entries
                    .filter((e) => e.kind === 'skill')
                    .map(entryTitle)
                    .slice(0, 12),
                  credits: entries
                    .filter((e) => e.kind === 'credit')
                    .map(entryTitle)
                    .slice(0, 8),
                  highlights: entries
                    .filter((e) => e.kind === 'award' || e.kind === 'experience')
                    .map(entryTitle)
                    .slice(0, 6),
                })}
                onAccept={set}
              />
            )
          : undefined
      }
    />
  );

  return (
    <ShowcaseShell
      wide
      title={resume.title}
      description={resume.targetRole ? `For ${resume.targetRole}` : undefined}
      back={{ to: `${base}/resumes`, label: 'All resumes' }}
      help={SHOWCASE_HELP.resumes}
      actions={
        <Button asChild>
          <Link to={`${base}/resumes/${resume.id}/print`}>
            <Printer size={16} aria-hidden="true" />
            Print view
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="What’s in it"
            icon={Filter}
            actions={
              !editingRules && (
                <Button size="sm" variant="outline" onClick={() => setEditingRules(true)}>
                  <Pencil size={14} aria-hidden="true" />
                  Edit rules
                </Button>
              )
            }
          >
            <RulesSentence rules={rules} subject="record" />
            {editingRules && (
              <div className="mt-5 border-t border-white/10 pt-5">
                <ResumeRulesEditor rules={rules} onChange={setRules} />
                <div className="mt-5 flex gap-2">
                  <Button
                    disabled={busy || !rulesDirty}
                    onClick={async () =>
                      (await patch({ rules: cleanRules(rules) }, 'Rules saved')) && setEditingRules(false)
                    }
                  >
                    Save rules
                  </Button>
                  <Button variant="ghost" onClick={() => (setRules(resume.rules || {}), setEditingRules(false))}>
                    {rulesDirty ? 'Discard changes' : 'Done'}
                  </Button>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Entries" icon={ScrollText}>
            {entries.length === 0 ? (
              <p className="text-sm text-slate-400">
                Your career record is empty.{' '}
                <Link to={`${base}/career`} className="text-violet-300 underline">
                  Add entries
                </Link>{' '}
                and they appear here.
              </p>
            ) : (
              order
                .filter((kind) => entries.some((e) => e.kind === kind))
                .map((kind) => (
                  <div key={kind} className="mb-4 last:mb-0">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {kindLabel(kind)}
                    </h3>
                    <ul className="divide-y divide-white/10">
                      {entries
                        .filter((e) => e.kind === kind)
                        .map((entry) => {
                          const state = itemState(entry.id, { pinned, excluded }, entryMatches(entry, rules));
                          return (
                            <li
                              key={entry.id}
                              className="flex flex-wrap items-center gap-3 py-2.5"
                              data-testid="resume-entry"
                            >
                              <div className="min-w-0 flex-1 basis-48">
                                <p className="font-medium break-words">{entryTitle(entry)}</p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <StateBadge state={state} />
                                  {entryDetail(entry)}
                                </p>
                              </div>
                              <StateActions
                                state={state}
                                name={entryTitle(entry)}
                                busy={busy}
                                onChange={(s) =>
                                  void run(() =>
                                    apiPut(`${path}/entries/${encodeURIComponent(entry.id)}`, { state: s }),
                                  )
                                }
                              />
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))
            )}
          </Panel>

          <Panel title="Headline and summary" icon={UserRound}>
            {summaryField('headline', 'Headline')}
            {summaryField('summary', 'Summary')}
          </Panel>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Section order" icon={ListOrdered}>
            <ol className="space-y-1.5">
              {order.map((kind, index) => (
                <li
                  key={kind}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-sm"
                >
                  <span className="flex-1">{kindLabel(kind)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    disabled={busy || index === 0}
                    aria-label={`Move ${kindLabel(kind)} up`}
                    onClick={() => void patch({ sectionOrder: move(order, index, -1) })}
                  >
                    <ArrowUp size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    disabled={busy || index === order.length - 1}
                    aria-label={`Move ${kindLabel(kind)} down`}
                    onClick={() => void patch({ sectionOrder: move(order, index, 1) })}
                  >
                    <ArrowDown size={16} />
                  </Button>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Settings" icon={Settings2}>
            <div className="space-y-3">
              <div>
                <label htmlFor="resume-name" className="text-sm font-medium text-slate-300">
                  Name
                </label>
                <Input
                  id="resume-name"
                  className="mt-1.5 border-white/15 bg-black/20"
                  value={meta?.title ?? resume.title}
                  onChange={(e) =>
                    setMeta({ title: e.target.value, targetRole: meta?.targetRole ?? resume.targetRole ?? '' })
                  }
                />
              </div>
              <div>
                <label htmlFor="resume-target" className="text-sm font-medium text-slate-300">
                  Aimed at
                </label>
                <Input
                  id="resume-target"
                  className="mt-1.5 border-white/15 bg-black/20"
                  value={meta?.targetRole ?? resume.targetRole ?? ''}
                  onChange={(e) => setMeta({ title: meta?.title ?? resume.title, targetRole: e.target.value })}
                />
              </div>
              {meta && (
                <Button
                  size="sm"
                  disabled={busy || !meta.title.trim()}
                  onClick={async () =>
                    (await patch({ title: meta.title.trim(), targetRole: meta.targetRole.trim() || null }, 'Saved')) &&
                    setMeta(null)
                  }
                >
                  Save name
                </Button>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {resume.isDefault ? (
                  <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-400/15 px-3 text-sm text-amber-200">
                    <Star size={14} aria-hidden="true" />
                    Default for applications
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => apiPost(`${path}/default`), 'Set as default')}
                  >
                    <Star size={14} aria-hidden="true" />
                    Set as default
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="border-white/10 bg-slate-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{resume.title}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Your career record stays as it is. Applications already sent keep their copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-500"
              onClick={async () => {
                try {
                  await apiDelete(path);
                  toast.success('Resume deleted');
                  nav(`${base}/resumes`);
                } catch (e: unknown) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Delete resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ShowcaseShell>
  );
}
