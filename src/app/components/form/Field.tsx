import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '../ui/utils';

/** The attributes Field puts on its control so the label, hint and error are announced with it. */
export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  'aria-required'?: true;
}

type ControlElement = ReactElement<{ id?: string; 'aria-describedby'?: string }>;

export interface FieldProps {
  /** The control's id; the label's htmlFor, and the prefix of the hint and error ids. */
  id: string;
  label: ReactNode;
  /** Shows "*" (announced as "required") and sets aria-required on the control. */
  required?: boolean;
  /** Shows "(optional)" after the label, for forms where most fields are required. */
  optional?: boolean;
  hint?: ReactNode;
  /** The field's error message; shown under the control with role=alert and sets aria-invalid. */
  error?: string;
  /** Current length, shown as "count / maxLength" when maxLength is set. */
  count?: number;
  maxLength?: number;
  className?: string;
  labelClassName?: string;
  /**
   * One control element (it receives id and the aria attributes), or a function that receives
   * those props for controls that need them placed on an inner element (e.g. a Select trigger).
   */
  children: ControlElement | ((control: FieldControlProps) => ReactNode);
}

export function fieldHintId(id: string) {
  return `${id}-hint`;
}

export function fieldErrorId(id: string) {
  return `${id}-error`;
}

/**
 * A labelled form control: a visible label bound with htmlFor, an optional hint and counter,
 * and an inline error slot. The control gets aria-invalid / aria-describedby / aria-required,
 * so assistive technology reads the label, the hint and the error together.
 */
export function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  count,
  maxLength,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const hintId = hint ? fieldHintId(id) : undefined;
  const errorId = error ? fieldErrorId(id) : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control: FieldControlProps = {
    id,
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  let rendered: ReactNode;
  if (typeof children === 'function') {
    rendered = children(control);
  } else if (isValidElement(children)) {
    const own = children.props['aria-describedby'];
    rendered = cloneElement(children, {
      ...control,
      'aria-describedby': [own, describedBy].filter(Boolean).join(' ') || undefined,
    });
  } else {
    rendered = children;
  }
  const over = maxLength !== undefined && count !== undefined && count > maxLength;

  return (
    <div className={cn('space-y-1.5', className)} data-slot="field">
      <label htmlFor={id} className={cn('block text-sm font-medium text-slate-300', labelClassName)}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-rose-300">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
        {optional && !required && <span className="ml-1 font-normal text-slate-500">(optional)</span>}
      </label>
      {rendered}
      {(hint || maxLength !== undefined) && (
        <div className="flex items-start justify-between gap-3 text-xs text-slate-500">
          {hint ? <p id={hintId}>{hint}</p> : <span />}
          {maxLength !== undefined && count !== undefined && (
            <span className={cn('shrink-0 tabular-nums', over && 'text-rose-300')} data-testid={`${id}-count`}>
              {count.toLocaleString()} / {maxLength.toLocaleString()}
            </span>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-rose-300 [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level message (an error that belongs to no single field), announced when it appears. */
export function FormError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={cn('text-sm text-rose-300', className)}>
      {message}
    </p>
  );
}

/** "Fields marked * are required", shown once at the top of forms that use required markers. */
export function RequiredNote({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs text-slate-500', className)}>
      Fields marked <span aria-hidden="true">*</span>
      <span className="sr-only">with an asterisk</span> are required.
    </p>
  );
}
