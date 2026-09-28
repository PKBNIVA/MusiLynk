import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Ban, Undo2, Gift, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiGet, apiPatch } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { AdminUser } from '../../lib/apiTypes';
import { Panel, Empty, date, type AdminActions } from './shared';

const PER_PAGE = 50;
const ROLES = ['jobseeker', 'employer', 'admin'] as const;
const STATUSES = ['active', 'suspended', 'pending', 'deleted'] as const;

type UsersResponse = { users: AdminUser[]; page: number; perPage: number; total: number };

// Users is the one admin list with real server-side search: it fetches its own
// page from `GET /admin/users?q=&role=&status=&page=&perPage=` instead of
// filtering whatever the console's initial load happened to bring back, so an
// account outside the newest page is still reachable (FORM-01).
export default function UsersTab({ actions }: { actions: AdminActions }) {
  const { busy, patch, act, setGrant, setConfirm } = actions;
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResponse>({ users: [], page: 1, perPage: PER_PAGE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = (p: number) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(p), perPage: String(PER_PAGE) });
    if (query.trim()) params.set('q', query.trim());
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    apiGet<UsersResponse>(`/admin/users?${params.toString()}`)
      .then((res) => {
        if (id !== requestId.current) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (id !== requestId.current) return;
        setError(errorMessage(e, 'Unable to load users.'));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  };

  // Debounced re-search: any filter change goes back to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load(1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, role, status]);
  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const { users, total, perPage } = data;
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <Panel error={error} onRetry={() => load(page)} loading={loading}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Label htmlFor="admin-user-filter" className="sr-only">
            Search users
          </Label>
          <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="admin-user-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or id"
            className="pl-9 bg-white/5 border-white/15"
          />
        </div>
        <Label htmlFor="admin-user-role" className="sr-only">
          Filter by role
        </Label>
        <select
          id="admin-user-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-10 rounded-md bg-slate-900 border border-white/15 px-3 text-sm"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Label htmlFor="admin-user-status" className="sr-only">
          Filter by status
        </Label>
        <select
          id="admin-user-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md bg-slate-900 border border-white/15 px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-slate-400 mt-3" aria-live="polite">
        {total === 0
          ? '0 users'
          : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} users`}
      </p>
      <div className="space-y-3 mt-3">
        {!loading && users.length === 0 && (
          <Empty text={query || role || status ? 'No users match this search.' : 'No users yet.'} />
        )}
        {users.map((u) => (
          <Card key={u.id} className="bg-white/[.05] border-white/10">
            <CardContent className="p-4 md:p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold break-words">{u.name}</h2>
                  {u.verified && <ShieldCheck size={15} className="text-emerald-300" aria-label="Verified" />}
                </div>
                <div className="text-sm text-slate-400 break-all">
                  {u.email} · {u.role} · joined {date(u.createdAt)}
                </div>
                <Badge className="mt-2">{u.status}</Badge>
              </div>
              {u.role !== 'admin' && (
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() => setGrant({ id: u.id, name: u.name, email: u.email })}
                  >
                    <Gift aria-hidden="true" size={15} className="mr-1" />
                    Grant plan
                  </Button>
                  {u.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        setConfirm({
                          title: `Suspend ${u.name}?`,
                          description: `${u.email} will be signed out everywhere and cannot sign in until restored.`,
                          confirmLabel: 'Suspend user',
                          destructive: true,
                          run: () =>
                            act(
                              `user:${u.id}`,
                              () => apiPatch(`/admin/users/${u.id}`, { status: 'suspended' }),
                              'User suspended',
                            ).then(() => load(page)),
                        })
                      }
                    >
                      <Ban aria-hidden="true" size={15} className="mr-1" />
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        patch(`user:${u.id}`, `/admin/users/${u.id}`, { status: 'active' }, 'User restored').then(() =>
                          load(page),
                        )
                      }
                    >
                      <Undo2 aria-hidden="true" size={15} className="mr-1" />
                      Restore
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {total > perPage && (
        <div className="flex items-center justify-between gap-3 mt-4">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft aria-hidden="true" size={15} className="mr-1" />
            Previous
          </Button>
          <span className="text-sm text-slate-400">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight aria-hidden="true" size={15} className="ml-1" />
          </Button>
        </div>
      )}
    </Panel>
  );
}
