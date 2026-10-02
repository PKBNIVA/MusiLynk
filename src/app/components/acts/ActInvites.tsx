import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import type { ActInviteForMe, ActInviteOwner, ActMembership, InvitableMusician } from '../../lib/apiTypes';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Field } from '../form/Field';
import { FormDialog, type ConfirmRequest } from '../booking/BookingDialogs';

type Ask = (request: ConfirmRequest) => void;

/** "Invites" on the musician side: bandmate invites waiting for an answer. Nothing joins until Accept. */
export function MyInvites({ onChanged }: { onChanged: () => void }) {
  const [invites, setInvites] = useState<ActInviteForMe[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ invites?: ActInviteForMe[] }>('/act-invites/mine');
      setInvites(d.invites || []);
    } catch {
      setInvites([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function answer(invite: ActInviteForMe, kind: 'accept' | 'decline') {
    if (busyId) return;
    setBusyId(invite.id);
    setError('');
    try {
      await apiPost(kind === 'accept' ? `/act-invites/${invite.id}/accept` : `/act-invites/${invite.id}/decline`, {});
      toast.success(kind === 'accept' ? `You joined ${invite.actName}` : 'Invite declined');
      await load();
      if (kind === 'accept') onChanged();
    } catch (e: unknown) {
      setError(errorMessage(e, 'Something went wrong. Try again.'));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (invites.length === 0 && !error) return null;
  return (
    <section id="invites" aria-labelledby="invites-heading" className="mb-6">
      <h2 id="invites-heading" className="mb-3 text-xl font-semibold">
        Invites
      </h2>
      {error && (
        <p role="alert" className="mb-2 text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {invites.map((i) => (
          <Card key={i.id} className="border-violet-400/30 bg-violet-500/10">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {i.inviterName} invited you to join {i.actName}
                </p>
                <p className="text-sm text-slate-300">
                  As {i.roleName}
                  {i.instrument ? ` · ${i.instrument}` : ''} · expires {formatDate(i.expiresAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={busyId === i.id}
                  aria-label={`Accept invite to ${i.actName}`}
                  onClick={() => void answer(i, 'accept')}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === i.id}
                  aria-label={`Decline invite to ${i.actName}`}
                  onClick={() => void answer(i, 'decline')}
                >
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Acts the musician plays in but does not own, each with a way to leave. */
export function Memberships({
  memberships,
  ask,
  onChanged,
}: {
  memberships: ActMembership[];
  ask: Ask;
  onChanged: () => void;
}) {
  if (memberships.length === 0) return null;
  return (
    <section aria-labelledby="memberships-heading" className="mb-6">
      <h2 id="memberships-heading" className="mb-3 text-xl font-semibold">
        Bands you play in
      </h2>
      <div className="space-y-2">
        {memberships.map((m) => (
          <div
            key={m.actId}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[.055] p-3"
          >
            <div className="min-w-0">
              <div className="break-words font-medium">{m.actName}</div>
              <div className="text-xs text-slate-400">
                {m.roleName}
                {m.instrument ? ` · ${m.instrument}` : ''}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Leave ${m.actName}`}
              onClick={() =>
                ask({
                  title: `Leave ${m.actName}?`,
                  description: "You'll be taken off the lineup. The band can invite you again.",
                  confirmLabel: 'Leave band',
                  destructive: true,
                  action: async () => {
                    await apiPost(`/acts/${m.actId}/leave`);
                    toast.success(`You left ${m.actName}`);
                    onChanged();
                  },
                })
              }
            >
              Leave
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

const STATE_LABEL: Record<string, string> = {
  pending: 'Waiting for a reply',
  expired: 'Expired',
  declined: 'Declined',
  accepted: 'Accepted',
  revoked: 'Cancelled',
};

/** The owner's pending invites for one act, with Resend and Revoke. */
export function PendingInvites({ actId, refreshKey, ask }: { actId: string; refreshKey: number; ask: Ask }) {
  const [invites, setInvites] = useState<ActInviteOwner[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ invites?: ActInviteOwner[] }>(`/acts/${actId}/invites`);
      setInvites(d.invites || []);
    } catch {
      setInvites([]);
    }
  }, [actId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function resend(invite: ActInviteOwner) {
    if (busyId) return;
    setBusyId(invite.id);
    setError('');
    try {
      await apiPost(`/acts/${actId}/invites/${invite.id}/resend`);
      toast.success('Invite sent again');
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, 'The invite could not be sent again.'));
    } finally {
      setBusyId(null);
    }
  }

  const waiting = invites.filter((i) => i.status === 'pending');
  const past = invites.filter((i) => i.status !== 'pending').slice(0, 3);
  if (waiting.length === 0 && past.length === 0) return null;
  const who = (i: ActInviteOwner) => i.inviteeName || i.inviteeEmail || 'Shared link';
  return (
    <div className="mt-4" data-testid={`pending-invites-${actId}`}>
      <h4 className="font-semibold">Invites</h4>
      {error && (
        <p role="alert" className="mt-1 text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="mt-2 space-y-2">
        {[...waiting, ...past].map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/15 p-3">
            <div className="min-w-0">
              <div className="break-words font-medium">{who(i)}</div>
              <div className="text-xs text-slate-400">
                {i.roleName}
                {i.instrument ? ` · ${i.instrument}` : ''} · {STATE_LABEL[i.status] ?? i.status}
                {i.status === 'pending' ? ` · expires ${formatDate(i.expiresAt)}` : ''}
              </div>
            </div>
            {i.status === 'pending' && (
              <div className="flex shrink-0 gap-1">
                {i.canResend && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === i.id}
                    aria-label={`Resend invite to ${who(i)}`}
                    onClick={() => void resend(i)}
                  >
                    Resend
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Revoke invite for ${who(i)}`}
                  onClick={() =>
                    ask({
                      title: `Revoke the invite for ${who(i)}?`,
                      description: 'Their link or invite stops working straight away. You can invite them again later.',
                      confirmLabel: 'Revoke invite',
                      destructive: true,
                      action: async () => {
                        await apiDelete(`/acts/${actId}/invites/${i.id}`);
                        toast.success('Invite revoked');
                        await load();
                      },
                    })
                  }
                >
                  Revoke
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Mode = 'user' | 'email' | 'link';
const MODES: { id: Mode; label: string; icon: typeof Search }[] = [
  { id: 'user', label: 'Find on MusiLynk', icon: Search },
  { id: 'email', label: 'By email', icon: Mail },
  { id: 'link', label: 'Share a link', icon: MessageCircle },
];

/** Invite a bandmate to an act: a MusiLynk musician (found by name), an email address, or a shareable link. */
export function InviteBandmateDialog({
  act,
  onClose,
  onInvited,
}: {
  act: { id: string; name: string } | null;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [mode, setMode] = useState<Mode>('user');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InvitableMusician[]>([]);
  const [chosen, setChosen] = useState<InvitableMusician | null>(null);
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const actId = act?.id;

  useEffect(() => {
    setMode('user');
    setQuery('');
    setResults([]);
    setChosen(null);
    setEmail('');
    setRoleName('');
    setInstrument('');
    setError('');
    setLink('');
    setCopied(false);
  }, [actId]);

  useEffect(() => {
    if (!actId || mode !== 'user' || chosen || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      apiGet<{ musicians?: InvitableMusician[] }>(`/acts/${actId}/invitees?q=${encodeURIComponent(query.trim())}`)
        .then((d) => live && setResults(d.musicians || []))
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [actId, mode, query, chosen]);

  const canSubmit =
    Boolean(roleName.trim()) && (mode === 'link' || (mode === 'user' ? Boolean(chosen) : /\S+@\S+\.\S+/.test(email)));

  async function submit() {
    if (!act || busy) return;
    if (link) return onClose();
    setBusy(true);
    setError('');
    try {
      const d = await apiPost<{ link?: string }>(`/acts/${act.id}/invites`, {
        kind: mode,
        userId: mode === 'user' ? chosen?.id : undefined,
        email: mode === 'email' ? email.trim() : undefined,
        roleName: roleName.trim(),
        instrument: instrument.trim() || undefined,
      });
      onInvited();
      if (mode === 'link' && d.link) setLink(d.link);
      else {
        toast.success('Invite sent');
        onClose();
      }
    } catch (e: unknown) {
      setError(errorMessage(e, 'The invite could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the link and copy it.');
    }
  }

  const share = `${act?.name ?? 'My band'} invited you to join on MusiLynk: ${link}`;
  return (
    <FormDialog
      open={Boolean(act)}
      onOpenChange={(open) => !open && onClose()}
      title="Invite a bandmate"
      description={act ? `They join ${act.name} only if they accept. Invites expire after 7 days.` : undefined}
      submitLabel={link ? 'Done' : mode === 'link' ? 'Create link' : 'Send invite'}
      busyLabel="Sending…"
      busy={busy}
      canSubmit={link ? true : canSubmit}
      error={error}
      onSubmit={submit}
    >
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            This link works once, for one bandmate, for 7 days. You can revoke it any time.
          </p>
          <Input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer">
                <Send size={14} />
                Share on WhatsApp
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="How to invite" className="grid grid-cols-3 gap-1 rounded-xl bg-black/20 p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  setError('');
                }}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium sm:text-sm ${
                  mode === m.id ? 'bg-violet-500/30 text-white' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <m.icon size={14} aria-hidden />
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'user' &&
            (chosen ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-black/20 p-3">
                <span className="min-w-0 break-words">
                  <span className="block text-xs text-slate-400">Inviting</span>
                  {chosen.name}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div>
                <Field id="invite-search" label="Search by name, role or city" required>
                  <Input
                    value={query}
                    autoComplete="off"
                    placeholder="e.g. Rohan or tabla"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </Field>
                {results.length > 0 && (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto" aria-label="Matching musicians">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg bg-black/20 p-3 text-left hover:bg-white/10"
                          onClick={() => {
                            setChosen(r);
                            setResults([]);
                          }}
                        >
                          <span className="block break-words font-medium">{r.name}</span>
                          <span className="block text-xs text-slate-400">
                            {[r.roles.join(', '), r.location].filter(Boolean).join(' · ') || r.headline}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          {mode === 'email' && (
            <Field
              id="invite-email"
              label="Their email address"
              required
              hint="They get one email with a link to answer."
            >
              <Input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          {mode === 'link' && (
            <p className="text-sm text-slate-300">
              Make a link for one bandmate and send it on WhatsApp. It works once and expires in 7 days.
            </p>
          )}
          <Field id="invite-role" label="Role in the act" required hint="For example Vocalist or Drummer">
            <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} />
          </Field>
          <Field id="invite-instrument" label="Instrument or voice" optional>
            <Input value={instrument} onChange={(e) => setInstrument(e.target.value)} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
