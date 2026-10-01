import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { BookOpenCheck, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { AppSelect } from '../../components/ui/app-select';
import { Field } from '../../components/form/Field';
import { optionLabel } from '../../components/ui/option-labels';
import { ChipInput, LoadState, Panel, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import {
  announceSuggestionsChanged,
  CAREER_KINDS,
  entryDetail,
  entryTitle,
  type CareerEntry,
  type CareerKind,
} from '../../lib/showcase';

type Draft = {
  id?: string;
  kind: CareerKind;
  fields: Record<string, string | boolean>;
  startOn: string;
  endOn: string;
  tags: string[];
};

function toDraft(entry: CareerEntry): Draft {
  const fields: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(entry.fields))
    if (v !== null && v !== undefined) fields[k] = typeof v === 'boolean' ? v : String(v);
  return {
    id: entry.id,
    kind: entry.kind,
    fields,
    startOn: (entry.startOn || '').slice(0, 7),
    endOn: (entry.endOn || '').slice(0, 7),
    tags: entry.tags || [],
  };
}

function EntryForm({
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
  errors,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  errors: Record<string, string>;
}) {
  const spec = CAREER_KINDS.find((k) => k.kind === draft.kind)!;
  const setField = (name: string, value: string | boolean) =>
    onChange({ ...draft, fields: { ...draft.fields, [name]: value } });
  const fid = (name: string) => `career-${draft.kind}-${name}`;
  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-violet-400/25 bg-black/20 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map((f) =>
          f.type === 'bool' ? (
            <label key={f.name} className="flex min-h-11 items-center gap-2 text-sm text-slate-300 sm:col-span-2">
              <input
                type="checkbox"
                className="accent-violet-400"
                checked={Boolean(draft.fields[f.name])}
                onChange={(e) => setField(f.name, e.target.checked)}
              />
              {f.label}
            </label>
          ) : f.type === 'select' ? (
            <div key={f.name}>
              <label htmlFor={fid(f.name)} className="text-sm font-medium text-slate-300">
                {f.label}
              </label>
              <AppSelect
                id={fid(f.name)}
                className="mt-1.5"
                value={String(draft.fields[f.name] || '')}
                onValueChange={(v) => setField(f.name, v)}
                descriptions={false}
                options={[
                  { value: '', label: 'Not set' },
                  ...(f.options || []).map((o) => ({ value: o, label: optionLabel(o) })),
                ]}
              />
            </div>
          ) : (
            <Field
              key={f.name}
              id={fid(f.name)}
              label={f.label}
              required={f.required}
              error={errors[f.name]}
              className={f.type === 'textarea' ? 'sm:col-span-2' : ''}
            >
              {f.type === 'textarea' ? (
                <Textarea
                  value={String(draft.fields[f.name] || '')}
                  maxLength={2000}
                  onChange={(e) => setField(f.name, e.target.value)}
                  className="border-white/15 bg-black/20"
                />
              ) : (
                <Input
                  type={f.type === 'url' ? 'url' : f.type === 'year' ? 'number' : 'text'}
                  inputMode={f.type === 'year' ? 'numeric' : undefined}
                  placeholder={f.type === 'url' ? 'https://' : undefined}
                  value={String(draft.fields[f.name] || '')}
                  onChange={(e) => setField(f.name, e.target.value)}
                  className="border-white/15 bg-black/20"
                />
              )}
            </Field>
          ),
        )}
        {spec.dated && (
          <>
            <Field
              id={fid('start')}
              label="From"
              optional
              hint="A year, or year and month (2024-06)."
              error={errors.startOn}
            >
              <Input
                value={draft.startOn}
                onChange={(e) => onChange({ ...draft, startOn: e.target.value })}
                placeholder="2022"
                className="border-white/15 bg-black/20"
              />
            </Field>
            <Field id={fid('end')} label="To" optional error={errors.endOn}>
              <Input
                value={draft.endOn}
                onChange={(e) => onChange({ ...draft, endOn: e.target.value })}
                placeholder="2024"
                className="border-white/15 bg-black/20"
              />
            </Field>
          </>
        )}
      </div>
      <ChipInput
        label="Tags (optional)"
        values={draft.tags}
        onChange={(tags) => onChange({ ...draft, tags })}
        placeholder="film, live, teaching…"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {draft.id ? 'Save' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CareerRecord() {
  const base = useWorkspaceBase();
  const [entries, setEntries] = useState<CareerEntry[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    apiGet<{ entries?: CareerEntry[] }>('/career-entries')
      .then((d) => setEntries(d.entries || []))
      .catch((e: unknown) => setError(errorMessage(e, 'Your career record could not be loaded.')));
  }, []);
  useEffect(load, [load]);

  function start(kind: CareerKind) {
    setErrors({});
    setDraft({ kind, fields: {}, startOn: '', endOn: '', tags: [] });
    requestAnimationFrame(() =>
      document.getElementById(`career-${kind}-${CAREER_KINDS.find((k) => k.kind === kind)!.fields[0].name}`)?.focus(),
    );
  }

  async function save() {
    if (!draft) return;
    const spec = CAREER_KINDS.find((k) => k.kind === draft.kind)!;
    const missing: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = draft.fields[f.name];
      if (f.required && !String(v ?? '').trim()) missing[f.name] = `Add the ${f.label.toLowerCase()}.`;
      else if (f.type === 'url' && v && !/^https:\/\//i.test(String(v)))
        missing[f.name] = 'Links must start with https://';
    }
    const date = /^\d{4}(-\d{2}(-\d{2})?)?$/;
    if (draft.startOn && !date.test(draft.startOn)) missing.startOn = 'Use 2024 or 2024-06.';
    if (draft.endOn && !date.test(draft.endOn)) missing.endOn = 'Use 2024 or 2024-06.';
    setErrors(missing);
    if (Object.keys(missing).length) return;
    const fields = Object.fromEntries(
      Object.entries(draft.fields)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => [
          k,
          spec.fields.find((f) => f.name === k)?.type === 'year' ? Number(v) : typeof v === 'string' ? v.trim() : v,
        ]),
    );
    const body = {
      kind: draft.kind,
      fields,
      startOn: draft.startOn || null,
      endOn: draft.endOn || null,
      tags: draft.tags,
    };
    setBusy(true);
    try {
      if (draft.id) {
        const out = await apiPatch<{ entry: CareerEntry }>(`/career-entries/${draft.id}`, body);
        setEntries((list) => (list || []).map((e) => (e.id === out.entry.id ? out.entry : e)));
      } else {
        const out = await apiPost<{ entry: CareerEntry }>('/career-entries', body);
        setEntries((list) => [...(list || []), out.entry]);
      }
      toast.success('Saved. Every resume that includes it is up to date.');
      announceSuggestionsChanged();
      setDraft(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'This entry could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CareerEntry) {
    try {
      await apiDelete(`/career-entries/${entry.id}`);
      setEntries((list) => (list || []).filter((e) => e.id !== entry.id));
      toast.success(`Removed “${entryTitle(entry)}”`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <ShowcaseShell
      title="Career record"
      help={SHOWCASE_HELP.career}
      back={{ to: `${base}/resumes`, label: 'Resumes' }}
      actions={
        <Button variant="outline" asChild>
          <Link to={`${base}/resumes`}>
            <ScrollText size={16} aria-hidden="true" />
            Resumes
          </Link>
        </Button>
      }
    >
      {entries === null ? (
        <LoadState error={error} onRetry={load} />
      ) : (
        <>
          <nav aria-label="Sections" className="mb-5 flex gap-2 overflow-x-auto pb-1">
            {CAREER_KINDS.map((k) => (
              <a
                key={k.kind}
                href={`#career-${k.kind}`}
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-sm text-slate-300 hover:border-white/25"
              >
                {k.label}
                <span className="text-xs text-slate-500">{entries.filter((e) => e.kind === k.kind).length}</span>
              </a>
            ))}
          </nav>
          <div className="space-y-4">
            {CAREER_KINDS.map((k) => {
              const list = entries
                .filter((e) => e.kind === k.kind)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              const adding = draft && !draft.id && draft.kind === k.kind;
              return (
                <Panel
                  key={k.kind}
                  id={`career-${k.kind}`}
                  title={k.label}
                  icon={BookOpenCheck}
                  className="scroll-mt-28"
                  actions={
                    !adding && (
                      <Button size="sm" variant="outline" onClick={() => start(k.kind)}>
                        <Plus size={14} aria-hidden="true" />
                        Add<span className="sr-only"> to {k.label.toLowerCase()}</span>
                      </Button>
                    )
                  }
                >
                  {list.length === 0 && !adding && <p className="text-sm text-slate-500">Nothing here yet.</p>}
                  <ul className="divide-y divide-white/10">
                    {list.map((entry) => (
                      <li key={entry.id} className="py-3 first:pt-0" data-testid="career-entry">
                        {draft?.id === entry.id ? (
                          <EntryForm
                            draft={draft}
                            onChange={setDraft}
                            onSave={() => void save()}
                            onCancel={() => setDraft(null)}
                            busy={busy}
                            errors={errors}
                          />
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium break-words">{entryTitle(entry)}</p>
                              {entryDetail(entry) && <p className="text-sm text-slate-400">{entryDetail(entry)}</p>}
                              {(entry.tags || []).length > 0 && (
                                <p className="mt-1 text-xs text-violet-200">{(entry.tags || []).join(' · ')}</p>
                              )}
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${entryTitle(entry)}`}
                              onClick={() => (setErrors({}), setDraft(toDraft(entry)))}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${entryTitle(entry)}`}
                              onClick={() => void remove(entry)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {adding && (
                    <EntryForm
                      draft={draft}
                      onChange={setDraft}
                      onSave={() => void save()}
                      onCancel={() => setDraft(null)}
                      busy={busy}
                      errors={errors}
                    />
                  )}
                </Panel>
              );
            })}
          </div>
        </>
      )}
    </ShowcaseShell>
  );
}
