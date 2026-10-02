import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../ui/utils';

/**
 * A small info button that sits next to a field label (never inside it, so the field's accessible
 * name stays the label text) and opens a one- or two-sentence explanation. A popover rather than a
 * hover tooltip, so it works on touch screens and with the keyboard.
 */
export function FieldHelp({ topic, children, className }: { topic: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          title={`About ${topic.toLowerCase()}`}
          className={cn(
            '-m-2 inline-grid size-10 shrink-0 place-items-center rounded-full text-slate-400 outline-none hover:bg-white/10 hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400',
            className,
          )}
        >
          <Info aria-hidden="true" size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 rounded-xl border-white/10 bg-[#15151f] p-3.5 text-sm leading-relaxed text-slate-200 shadow-2xl shadow-black/50"
      >
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-white">
          <Info aria-hidden="true" size={16} className="text-violet-300" />
          {topic}
        </p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A label row with the help button beside it; `label` is the element that carries htmlFor. */
export function LabelWithHelp({ label, help, topic }: { label: ReactNode; help: ReactNode; topic: string }) {
  return (
    <div className="flex items-center gap-1">
      {label}
      <FieldHelp topic={topic}>{help}</FieldHelp>
    </div>
  );
}
