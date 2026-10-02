import { useState, type ReactNode } from 'react';
import { Link2, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { AppSelect } from '../ui/app-select';
import { AutocompleteInput } from '../ai/AutocompleteInput';
import { formatRates, RATE_BASES, type Rates } from '../../lib/showcase';
import { optionLabel } from '../ui/option-labels';

type Value = string | string[] | Rates | null | undefined;
type Kind = 'text' | 'textarea' | 'genres' | 'rates';

function show(kind: Kind, value: Value) {
  if (kind === 'genres') return ((value as string[]) || []).join(', ');
  if (kind === 'rates') return formatRates(value as Rates);
  return (value as string) || '';
}

/**
 * One field that normally comes from the profile. Shows "Inherited from your profile" with an
 * Override button, or the portfolio's own value with "Reset to profile".
 */
export function InheritedField({
  id,
  label,
  kind,
  value,
  master,
  overridden,
  masterLabel = 'your profile',
  busy,
  onSave,
  onReset,
  ai,
}: {
  id: string;
  label: string;
  kind: Kind;
  value: Value;
  master: Value;
  overridden: boolean;
  masterLabel?: string;
  busy?: boolean;
  onSave: (value: Value) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  /** An AI helper rendered beside the editor (gets the draft and a setter). */
  ai?: (draft: string, set: (text: string) => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Value>(value);
  const start = () => {
    setDraft(kind === 'rates' ? { currency: 'INR', ...((value as Rates) || {}) } : value);
    setEditing(true);
  };
  const save = async () => {
    await onSave(kind === 'text' || kind === 'textarea' ? String(draft || '').trim() || null : draft);
    setEditing(false);
  };
  const shown = show(kind, value);
  return (
    <div className="border-b border-white/10 py-4 first:pt-0 last:border-0 last:pb-0" data-testid={`inherited-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-300" id={`${id}-label`}>
            {label}
          </span>
          {overridden ? (
            <span className="rounded-full border border-violet-300/30 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-200">
              Your own version
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-300/30 bg-teal-400/10 px-2 py-0.5 text-xs font-semibold text-teal-200">
              <Link2 size={11} aria-hidden="true" />
              Inherited from {masterLabel}
            </span>
          )}
        </div>
        {!editing && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={start} disabled={busy}>
              <Pencil size={14} aria-hidden="true" />
              {overridden ? 'Edit' : 'Override'}
              <span className="sr-only"> {label.toLowerCase()}</span>
            </Button>
            {overridden && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2.5 text-xs"
                onClick={() => void onReset()}
                disabled={busy}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset to profile<span className="sr-only">: {label.toLowerCase()}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      {!editing ? (
        <>
          <p
            className={`mt-1.5 whitespace-pre-line text-sm [overflow-wrap:anywhere] ${shown ? 'text-slate-100' : 'text-slate-500'}`}
          >
            {shown || (overridden ? 'Left empty on purpose' : `Not set on ${masterLabel}`)}
          </p>
          {overridden && show(kind, master) && (
            <p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
              Profile says: {show(kind, master).slice(0, 140)}
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-2">
          {kind === 'text' && (
            <Input
              id={id}
              aria-labelledby={`${id}-label`}
              value={(draft as string) || ''}
              onChange={(e) => setDraft(e.target.value)}
              className="border-white/15 bg-black/20"
            />
          )}
          {kind === 'textarea' && (
            <>
              <Textarea
                id={id}
                aria-labelledby={`${id}-label`}
                value={(draft as string) || ''}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-28 border-white/15 bg-black/20"
              />
              {ai?.((draft as string) || '', (t) => setDraft(t))}
            </>
          )}
          {kind === 'genres' && (
            <AutocompleteInput
              id={id}
              field="genres"
              label={label}
              values={(draft as string[]) || []}
              onChange={setDraft}
            />
          )}
          {kind === 'rates' && <RatesEditor id={id} value={(draft as Rates) || {}} onChange={setDraft} />}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              Save {label.toLowerCase()}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RatesEditor({ id, value, onChange }: { id: string; value: Rates; onChange: (r: Rates) => void }) {
  const num = (v: string) => (v === '' ? null : Math.max(0, Math.round(Number(v))));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <label className="text-xs text-slate-400">
        From (₹)
        <Input
          id={id}
          type="number"
          min={0}
          value={value.min ?? ''}
          onChange={(e) => onChange({ ...value, min: num(e.target.value) })}
          className="mt-1 border-white/15 bg-black/20"
        />
      </label>
      <label className="text-xs text-slate-400">
        To (₹)
        <Input
          type="number"
          min={0}
          value={value.max ?? ''}
          onChange={(e) => onChange({ ...value, max: num(e.target.value) })}
          className="mt-1 border-white/15 bg-black/20"
        />
      </label>
      <div className="col-span-2 text-xs text-slate-400 sm:col-span-1">
        <label htmlFor={`${id}-basis`}>Per</label>
        <AppSelect
          id={`${id}-basis`}
          className="mt-1"
          value={value.basis || 'session'}
          onValueChange={(v) => onChange({ ...value, basis: v })}
          descriptions={false}
          options={RATE_BASES.map((b) => ({ value: b, label: optionLabel(b) }))}
        />
      </div>
    </div>
  );
}
