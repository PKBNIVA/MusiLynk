import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon, type LucideIcon } from 'lucide-react';

import { SelectContent } from './select';
import { optionDescription, optionLabel } from './option-labels';
import { cn } from './utils';

export interface AppSelectOption {
  value: string;
  /** Defaults to the human label for the value (see option-labels.ts). */
  label?: React.ReactNode;
  /** One short line under the label. Pass `null` to hide the default description. */
  description?: string | null;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface AppSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<AppSelectOption | string>;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  contentClassName?: string;
  /** Show the one-line descriptions inside the list (default true). */
  descriptions?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
  'data-testid'?: string;
}

/* Radix Select reserves "" for "no value", so an "Any …" option with an empty value is mapped to this. */
const EMPTY = '__app_select_empty__';
const toRadix = (v: string) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

function normalise(option: AppSelectOption | string): AppSelectOption {
  return typeof option === 'string' ? { value: option } : option;
}

/**
 * The one dropdown used across the site: a dark Radix listbox with human labels, optional icons and
 * one-line descriptions, a check on the selected option, full keyboard support and 44px touch rows.
 * `value`/`onValueChange` carry the same raw strings a native <select> would submit.
 */
export function AppSelect({
  value,
  onValueChange,
  options,
  id,
  name,
  placeholder = 'Choose…',
  disabled,
  required,
  className,
  contentClassName,
  descriptions = true,
  ...aria
}: AppSelectProps) {
  const items = options.map(normalise);
  return (
    <SelectPrimitive.Root
      value={toRadix(value)}
      onValueChange={(v) => onValueChange(fromRadix(v))}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id}
        data-slot="select-trigger"
        className={cn(
          'flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-white/15 bg-[#101323] px-3 text-left text-sm text-slate-100 transition-[border-color,box-shadow,background-color] outline-none hover:border-violet-400/40 hover:bg-[#15182b] focus-visible:border-violet-400 focus-visible:ring-[3px] focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-rose-400 data-[placeholder]:text-slate-400 data-[state=open]:border-violet-400/60',
          className,
        )}
        {...aria}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectContent className={cn('max-h-80', contentClassName)}>
        {items.map((o) => {
          const Icon = o.icon;
          const desc =
            o.description === null || !descriptions ? undefined : (o.description ?? optionDescription(o.value));
          return (
            <SelectPrimitive.Item
              key={o.value || EMPTY}
              value={toRadix(o.value)}
              disabled={o.disabled}
              data-slot="select-item"
              className="relative flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg py-2 pr-9 pl-2.5 text-sm text-slate-200 outline-hidden select-none focus:bg-violet-500/20 focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:text-white sm:min-h-9"
            >
              {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-violet-300" />}
              <span className="flex min-w-0 flex-col">
                <SelectPrimitive.ItemText>{o.label ?? optionLabel(o.value)}</SelectPrimitive.ItemText>
                {desc && <span className="text-xs leading-snug text-slate-400">{desc}</span>}
              </span>
              <span className="absolute right-2.5 flex size-4 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                  <CheckIcon aria-hidden="true" className="size-4 text-violet-300" />
                </SelectPrimitive.ItemIndicator>
              </span>
            </SelectPrimitive.Item>
          );
        })}
      </SelectContent>
    </SelectPrimitive.Root>
  );
}
