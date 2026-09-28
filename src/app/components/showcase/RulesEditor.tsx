import { useId } from 'react';
import { AutocompleteInput } from '../ai/AutocompleteInput';
import { AppSelect } from '../ui/app-select';
import { MoreDetails } from '../help/MoreDetails';
import { FieldHelp } from '../help/FieldHelp';
import { ChipInput } from './parts';
import { cn } from '../ui/utils';
import {
  CAREER_KINDS,
  describeRules,
  setRulesMode,
  setRuleValues,
  type RuleField,
  type Rules,
} from '../../lib/showcase';

/** The rules as a sentence, the way every editor and list shows them. */
export function RulesSentence({
  rules,
  subject = 'work',
  className,
}: {
  rules?: Rules;
  subject?: 'work' | 'record';
  className?: string;
}) {
  return (
    <p className={cn('text-base text-slate-100', className)} data-testid="rules-sentence">
      {describeRules(rules, subject)}.
    </p>
  );
}

function ModeChoice({
  everything,
  onChange,
  subject,
}: {
  everything: boolean;
  onChange: (v: boolean) => void;
  subject: 'work' | 'record';
}) {
  const name = useId();
  const options = [
    {
      value: true,
      label: subject === 'work' ? 'All my work' : 'My whole record',
      hint: 'Narrow it down below if you like',
    },
    { value: false, label: 'Only what matches', hint: 'Nothing shows until something matches' },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-300">Start from</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm',
              everything === o.value
                ? 'border-violet-400/50 bg-violet-500/15'
                : 'border-white/10 hover:border-white/20',
            )}
          >
            <input
              type="radio"
              name={name}
              checked={everything === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 accent-violet-400"
            />
            <span>
              <span className="block font-medium text-white">{o.label}</span>
              <span className="block text-xs text-slate-400">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Years({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const set = (key: 'yearFrom' | 'yearTo', v: string) => {
    const n = Number(v);
    onChange({ ...rules, [key]: v && n >= 1900 && n <= 2100 ? n : undefined });
  };
  const input =
    'mt-1.5 h-11 w-full rounded-md border border-white/15 bg-white/[.04] px-3 text-sm text-slate-100 focus:border-violet-400 focus:outline-none';
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="text-sm text-slate-300">
        From year
        <input
          type="number"
          min={1900}
          max={2100}
          className={input}
          value={rules.yearFrom || ''}
          onChange={(e) => set('yearFrom', e.target.value)}
        />
      </label>
      <label className="text-sm text-slate-300">
        To year
        <input
          type="number"
          min={1900}
          max={2100}
          className={input}
          value={rules.yearTo || ''}
          onChange={(e) => set('yearTo', e.target.value)}
        />
      </label>
    </div>
  );
}

/** Rules for a portfolio: roles, genres, instruments and tags as chips; exclusions; years; order. */
export function PortfolioRulesEditor({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const everything = Boolean(rules.everything);
  const bucket = everything ? 'only' : 'any';
  const values = (f: RuleField) => rules[bucket]?.[f] || [];
  const set = (f: RuleField) => (v: string[]) => onChange(setRuleValues(rules, bucket, f, v));
  return (
    <div className="space-y-5">
      <ModeChoice everything={everything} onChange={(v) => onChange(setRulesMode(rules, v))} subject="work" />
      <div>
        <div className="mb-2 flex items-center gap-1 text-sm font-medium text-slate-300">
          {everything ? 'Limit it to (optional)' : 'Include work that has any of'}
          <FieldHelp topic="How matching works">
            {everything
              ? 'Work that states a genre (or role, or instrument) must match one of these. Work that states none stays in.'
              : 'Work joins when it has at least one of these values. Case doesn’t matter.'}
          </FieldHelp>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <AutocompleteInput
            field="roles"
            label="Your role"
            values={values('roles')}
            onChange={set('roles')}
            placeholder="Guitarist, Producer…"
          />
          <AutocompleteInput
            field="genres"
            label="Genres"
            values={values('genres')}
            onChange={set('genres')}
            placeholder="Jazz, Sufi…"
          />
          <AutocompleteInput
            field="instruments"
            label="Instruments"
            values={values('instruments')}
            onChange={set('instruments')}
            placeholder="Guitar, Tabla…"
          />
          <ChipInput label="Tags" values={values('tags')} onChange={set('tags')} placeholder="live, original…" />
        </div>
      </div>
      <ChipInput
        label="Leave out work tagged"
        values={rules.exclude?.tags || []}
        onChange={(v) => onChange(setRuleValues(rules, 'exclude', 'tags', v))}
        placeholder="cover, demo…"
      />
      <MoreDetails label="Years and order (optional)" defaultOpen={Boolean(rules.yearFrom || rules.yearTo)}>
        <Years rules={rules} onChange={onChange} />
        <div>
          <label htmlFor="rules-sort" className="text-sm text-slate-300">
            Order
          </label>
          <AppSelect
            id="rules-sort"
            className="mt-1.5"
            value={rules.sort || 'featured'}
            onValueChange={(v) => onChange({ ...rules, sort: v })}
            options={[
              { value: 'featured', label: 'Featured first', description: 'Then your library order' },
              { value: 'newest', label: 'Newest first', description: 'By year' },
            ]}
          />
        </div>
      </MoreDetails>
    </div>
  );
}

/** Rules for a resume: which sections (kinds) and tags. */
export function ResumeRulesEditor({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const everything = Boolean(rules.everything);
  const bucket = everything ? 'only' : 'any';
  const kinds = rules[bucket]?.kinds || [];
  const toggle = (kind: string) =>
    onChange(
      setRuleValues(rules, bucket, 'kinds', kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]),
    );
  return (
    <div className="space-y-5">
      <ModeChoice everything={everything} onChange={(v) => onChange(setRulesMode(rules, v))} subject="record" />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-300">
          {everything ? 'Only these sections (optional)' : 'Include these sections'}
        </legend>
        <div className="flex flex-wrap gap-2">
          {CAREER_KINDS.map((k) => (
            <label
              key={k.kind}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm',
                kinds.includes(k.kind)
                  ? 'border-violet-400/50 bg-violet-500/15 text-white'
                  : 'border-white/10 text-slate-300',
              )}
            >
              <input
                type="checkbox"
                className="accent-violet-400"
                checked={kinds.includes(k.kind)}
                onChange={() => toggle(k.kind)}
              />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      <ChipInput
        label="Only entries tagged (optional)"
        values={rules[bucket]?.tags || []}
        onChange={(v) => onChange(setRuleValues(rules, bucket, 'tags', v))}
        placeholder="film, live…"
      />
      <ChipInput
        label="Leave out entries tagged"
        values={rules.exclude?.tags || []}
        onChange={(v) => onChange(setRuleValues(rules, 'exclude', 'tags', v))}
        placeholder="old, student…"
      />
    </div>
  );
}
