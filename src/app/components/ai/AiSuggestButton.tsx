import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ApiError } from '../../lib/api';
import {
  isAiPaywallError,
  suggestAi,
  useAiTaskEnabled,
  type AiContext,
  type AiPaywallError,
  type AiTask,
} from '../../lib/ai';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { AiPaywallDialog } from './AiPaywallDialog';

export interface AiSuggestButtonProps {
  /** Which AiAssist task to call (job_description, cover_letter, improve_text, ...). */
  task: AiTask;
  /** Built fresh each time the popover opens, so it always reflects the form's latest values. */
  getContext: () => AiContext;
  /** Called with the suggestion text when the person chooses Insert or Replace. */
  onAccept: (text: string) => void;
  /** The field's current value, used to decide whether "Insert" appends or replaces. */
  value?: string;
  /** Button label; defaults to "Suggest" for an empty field or "Improve" for a filled one. */
  label?: string;
  className?: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'paywall'; error: AiPaywallError }
  | { kind: 'ready'; text: string };

/**
 * A small "Suggest" / "Improve" button for any writing field. Opens a popover with the AI's
 * suggestion and Insert / Replace / Try again / Discard — never sends anything on its own.
 * Renders nothing when AI Assist is disabled or does not offer this task.
 */
export function AiSuggestButton({ task, getContext, onAccept, value, label, className }: AiSuggestButtonProps) {
  const enabled = useAiTaskEnabled(task);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const statusId = useId();

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'error') resultRef.current?.focus();
  }, [state.kind]);

  if (!enabled) return null;

  const hasValue = Boolean(value && value.trim());
  const buttonLabel = label || (hasValue ? 'Improve' : 'Suggest');

  function requestSuggestion(regenerate = false) {
    setState({ kind: 'loading' });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    suggestAi(task, getContext(), { signal: controller.signal, regenerate })
      .then((result) => setState({ kind: 'ready', text: result.suggestion }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isAiPaywallError(error)) {
          setState({ kind: 'paywall', error });
          return;
        }
        const message =
          error instanceof ApiError
            ? friendlyMessage(error)
            : 'Something went wrong getting a suggestion. Please try again.';
        setState({ kind: 'error', message });
      });
  }

  if (state.kind === 'paywall') {
    return (
      <AiPaywallDialog
        error={state.error}
        billingEnabled={false}
        onClose={() => {
          setState({ kind: 'idle' });
          setOpen(false);
        }}
      />
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) requestSuggestion();
        else abortRef.current?.abort();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className} aria-label={`${buttonLabel} with AI`}>
          <Sparkles aria-hidden="true" />
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div aria-live="polite" className="sr-only" id={statusId}>
          {state.kind === 'loading' ? 'Getting a suggestion' : ''}
          {state.kind === 'error' ? state.message : ''}
          {state.kind === 'ready' ? 'Suggestion ready' : ''}
        </div>

        {state.kind === 'loading' && (
          <p className="text-sm text-slate-400" role="status">
            Thinking of something…
          </p>
        )}

        {state.kind === 'error' && (
          <div>
            <p className="text-sm text-red-400" role="alert">
              {state.message}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => requestSuggestion(true)}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {state.kind === 'ready' && (
          <div>
            <div
              ref={resultRef}
              tabIndex={-1}
              className="max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/20 p-3 text-sm whitespace-pre-wrap text-slate-100"
            >
              {state.text}
            </div>
            <p className="mt-2 text-xs text-slate-500">AI-written suggestion — review before using it.</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Discard
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => requestSuggestion(true)}>
                Try again
              </Button>
              {hasValue && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onAccept(`${value}\n\n${state.text}`.trim());
                    setOpen(false);
                  }}
                >
                  Insert
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onAccept(state.text);
                  setOpen(false);
                }}
              >
                Replace
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function friendlyMessage(error: ApiError): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return "You're using AI assist a lot right now — try again in a little while.";
    case 'AI_BUDGET_EXHAUSTED':
      return 'AI assist has reached today’s usage limit. Please try again tomorrow.';
    case 'AI_DISABLED':
      return 'AI assist is not available right now.';
    case 'AI_TIMEOUT':
      return 'That took too long. Please try again.';
    default:
      return error.message || 'Something went wrong getting a suggestion. Please try again.';
  }
}
