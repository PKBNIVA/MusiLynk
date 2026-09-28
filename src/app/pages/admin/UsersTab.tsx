import { useMemo, useState } from 'react';
import { ShieldCheck, Ban, Undo2, Gift, Search } from 'lucide-react';
import { apiPatch } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { AdminUser } from '../../lib/apiTypes';
import { Panel, Empty, date, USER_PAGE, type AdminActions } from './shared';

export default function UsersTab({
  users,
  error,
  loading,
  retry,
  actions,
}: {
  users: AdminUser[];
  error?: string;
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
}) {
  const { busy, patch, act, setGrant, setConfirm } = actions;
  const [userQuery, setUserQuery] = useState('');
  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return q ? users.filter((u) => `${u.name} ${u.email} ${u.role} ${u.status}`.toLowerCase().includes(q)) : users;
  }, [users, userQuery]);
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Label htmlFor="admin-user-filter" className="sr-only">
            Filter users
          </Label>
          <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            id="admin-user-filter"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Filter by name, email, role or status"
            className="pl-9 bg-white/5 border-white/15"
          />
        </div>
        <p className="text-sm text-slate-400" aria-live="polite">
          {filteredUsers.length} of {users.length} users
          {filteredUsers.length > USER_PAGE ? ` · showing first ${USER_PAGE}` : ''}
        </p>
      </div>
      {filteredUsers.length === 0 && <Empty text={users.length ? 'No users match this filter.' : 'No users yet.'} />}
      {filteredUsers.slice(0, USER_PAGE).map((u) => (
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
                          ),
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
                    onClick={() => patch(`user:${u.id}`, `/admin/users/${u.id}`, { status: 'active' }, 'User restored')}
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
    </Panel>
  );
}
