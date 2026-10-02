import { Building2, ChevronDown, Music, User, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { setActingAs } from '../../lib/api';
import { useAuth } from '../../lib/authContext';
import { useIdentities } from '../../lib/actingAs';
import { identityKind, type Identity, type IdentityType } from '../../lib/showcase';
import { cn } from '../ui/utils';

const ICONS: Record<IdentityType, LucideIcon> = { user: User, organization: Building2, act: Music };
const TINTS: Record<IdentityType, string> = {
  user: 'from-fuchsia-500 to-violet-600',
  organization: 'from-sky-500 to-teal-500',
  act: 'from-amber-500 to-rose-500',
};

export function IdentityAvatar({ identity, className }: { identity: Pick<Identity, 'type'>; className?: string }) {
  const Icon = ICONS[identity.type];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white',
        TINTS[identity.type],
        className,
      )}
    >
      <Icon size={14} />
    </span>
  );
}

/**
 * "Act as": You · Studio · Band. Hidden when the person runs no Pages. Switching stores the choice
 * (api.ts sends it as X-MusiLynk-Act-As on every request) and pages listening for it reload their data.
 */
export function IdentitySwitcher({ className }: { className?: string }) {
  const { user } = useAuth();
  const { identities, current } = useIdentities(user?.id);
  if (identities.length < 2 || !current) return null;
  const choose = (key: string) => {
    const next = identities.find((i) => i.key === key);
    if (!next || next.key === current.key) return;
    setActingAs(next.type === 'user' ? null : next.key);
    toast.success(next.type === 'user' ? 'Now acting as yourself' : `Now acting as ${next.name}`);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn('h-11 gap-2 rounded-full px-1.5 hover:bg-white/10 sm:pr-3', className)}
          aria-label={`Acting as ${current.name} (${identityKind(current.type)}). Switch identity`}
          data-testid="identity-switcher"
        >
          <IdentityAvatar identity={current} />
          <span className="hidden max-w-32 truncate text-sm text-white md:block">
            {current.type === 'user' ? 'You' : current.name}
          </span>
          <ChevronDown size={14} className="hidden text-slate-400 md:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">Act as</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.key} onValueChange={choose}>
          {identities.map((identity) => (
            <DropdownMenuRadioItem key={identity.key} value={identity.key} className="min-h-11 gap-3">
              <IdentityAvatar identity={identity} />
              <span className="min-w-0">
                <span className="block truncate">{identity.name}</span>
                <span className="block text-xs text-muted-foreground">{identityKind(identity.type)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <p className="px-2 pb-2 pt-1 text-xs text-muted-foreground">
          Posts, portfolios and suggestions follow who you act as. Your resumes stay personal.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small reminder, under the header, while acting as a Page. */
export function ActingAsChip() {
  const { user } = useAuth();
  const { current, actingAsPage } = useIdentities(user?.id);
  if (!actingAsPage || !current) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[76px] z-40 flex justify-center px-4"
      data-testid="acting-as-chip"
    >
      <p
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-teal-300/30 bg-[#0c1a1f]/95 py-1 pl-1 pr-2 text-xs text-teal-100 shadow-lg backdrop-blur"
      >
        <IdentityAvatar identity={current} className="size-5" />
        <span className="truncate">
          Acting as <b className="font-semibold">{current.name}</b>
        </span>
        <button
          type="button"
          onClick={() => {
            setActingAs(null);
            toast.success('Now acting as yourself');
          }}
          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-teal-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
        >
          Switch back
        </button>
      </p>
    </div>
  );
}
