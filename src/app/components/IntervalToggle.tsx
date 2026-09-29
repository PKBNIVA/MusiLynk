import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import type { BillingInterval } from '../lib/apiTypes';

/** Monthly / annual segmented control shared by the pricing and billing pages. */
export function IntervalToggle({
  value,
  onChange,
  className = '',
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
  className?: string;
}) {
  const item =
    'px-4 h-9 text-sm text-slate-300 data-[state=on]:bg-violet-600 data-[state=on]:text-white hover:bg-white/10 hover:text-white';
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === 'monthly' || next === 'annual') onChange(next);
      }}
      aria-label="Billing interval"
      variant="outline"
      className={`border border-white/15 rounded-lg overflow-hidden bg-white/5 ${className}`}
      data-testid="interval-toggle"
    >
      <ToggleGroupItem value="monthly" className={item}>
        Monthly
      </ToggleGroupItem>
      <ToggleGroupItem value="annual" className={item}>
        Annual <span className="ml-1.5 text-xs text-emerald-300">2 months free</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
