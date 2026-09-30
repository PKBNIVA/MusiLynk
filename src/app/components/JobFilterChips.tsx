import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { FormatGlyph } from './kit/FormatGlyph';
import { optionLabel } from './ui/option-labels';

export const FORMAT_KINDS = ['job', 'gig', 'session', 'audition', 'tour', 'teaching', 'collaboration', 'internship'];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata', 'Pune', 'Goa'];

const chip = (active: boolean) =>
  `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
    active
      ? 'border-violet-400/50 bg-violet-500/15 text-violet-100'
      : 'border-white/10 bg-white/[.04] text-slate-300 hover:bg-white/10'
  }`;

function ChipMenu({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={chip(active)}>
          {label}
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 border-white/10 bg-slate-900 p-1 text-white">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-white/10"
    >
      <span className="w-4 shrink-0">{selected && <Check aria-hidden="true" size={14} />}</span>
      {children}
    </button>
  );
}

type Filters = { kind: string; location: string; paid: string; workplace: string };

/** Sticky quick filters under the search bar. They drive the same URL filters as the Filters drawer. */
export function JobFilterChips({
  values,
  profileCity,
  onChange,
}: {
  values: Filters;
  profileCity?: string | null;
  onChange: (changes: Partial<Filters>) => void;
}) {
  const cities = [...(profileCity ? [profileCity] : []), ...CITIES.filter((c) => c !== profileCity)];
  if (values.location && !cities.includes(values.location)) cities.unshift(values.location);
  return (
    <div
      role="group"
      aria-label="Quick filters"
      className="sticky top-[72px] z-20 -mx-5 mb-4 flex gap-2 overflow-x-auto bg-slate-950/90 px-5 py-2 backdrop-blur md:mx-0 md:px-0"
      data-testid="job-filter-chips"
    >
      <ChipMenu label={values.kind ? `Format: ${optionLabel(values.kind)}` : 'Format'} active={Boolean(values.kind)}>
        {(close) => (
          <>
            <Option
              selected={!values.kind}
              onClick={() => {
                onChange({ kind: '' });
                close();
              }}
            >
              All formats
            </Option>
            {FORMAT_KINDS.map((k) => (
              <Option
                key={k}
                selected={values.kind === k}
                onClick={() => {
                  onChange({ kind: k });
                  close();
                }}
              >
                <FormatGlyph kind={k} size={16} />
                {optionLabel(k)}
              </Option>
            ))}
          </>
        )}
      </ChipMenu>
      <ChipMenu label={values.location ? `City: ${values.location}` : 'City'} active={Boolean(values.location)}>
        {(close) => (
          <>
            <Option
              selected={!values.location}
              onClick={() => {
                onChange({ location: '' });
                close();
              }}
            >
              Any city
            </Option>
            {cities.map((c) => (
              <Option
                key={c}
                selected={values.location === c}
                onClick={() => {
                  onChange({ location: c });
                  close();
                }}
              >
                {c}
                {c === profileCity ? <span className="text-xs text-slate-400">your city</span> : null}
              </Option>
            ))}
          </>
        )}
      </ChipMenu>
      <button
        type="button"
        aria-pressed={values.paid === 'true'}
        className={chip(values.paid === 'true')}
        onClick={() => onChange({ paid: values.paid === 'true' ? '' : 'true' })}
      >
        Pay disclosed
      </button>
      <button
        type="button"
        aria-pressed={values.workplace === 'remote'}
        className={chip(values.workplace === 'remote')}
        onClick={() => onChange({ workplace: values.workplace === 'remote' ? '' : 'remote' })}
      >
        Remote
      </button>
    </div>
  );
}
