import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Users,
  Briefcase,
  FileText,
  Activity,
  LogOut,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  Flag,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { usePageMeta } from '../components/PageMeta';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ReportReview } from '../components/admin/ReportReview';
import { errorMessage } from '../lib/errors';
import {
  type Data,
  type Source,
  type Payload,
  type Confirm,
  type Grant,
  type AdminActions,
  SOURCES,
  readSource,
  EMPTY,
  Stat,
  ConfirmDialog,
  GrantPlanDialog,
} from './admin/shared';

// Every tab is its own file under pages/admin/ so this file stays a thin shell:
// data loading, the shared moderation-action bag, and the tab list. Each tab
// is lazy-loaded so opening the console never pulls in every tab's code.
const QueueTab = lazy(() => import('./admin/QueueTab'));
const VerificationTab = lazy(() => import('./admin/VerificationTab'));
const ReportsTab = lazy(() => import('./admin/ReportsTab'));
const UsersTab = lazy(() => import('./admin/UsersTab'));
const ReviewsTab = lazy(() => import('./admin/ReviewsTab'));
const SignInDoctorTab = lazy(() => import('./admin/SignInDoctorTab'));
const CommerceTab = lazy(() => import('./admin/CommerceTab'));
const OperationsTab = lazy(() => import('./admin/OperationsTab'));
const DemoDataTab = lazy(() => import('./admin/DemoDataTab'));
const AuditTab = lazy(() => import('./admin/AuditTab'));

export default function AdminDashboard() {
  const { user, logout } = useAuth(),
    nav = useNavigate();
  usePageMeta('Admin · Trust & Operations', 'Verse moderation, verification, marketplace health and audit.');
  const [data, setData] = useState<Data>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const keys = Object.keys(SOURCES) as Source[];
    const settled = await Promise.allSettled(keys.map((k) => apiGet<Payload | null>(SOURCES[k][0])));
    const next: Partial<Data> = {},
      nextErrors: Partial<Record<Source, string>> = {};
    settled.forEach((result, i) => {
      const k = keys[i];
      if (result.status === 'fulfilled') readSource(next, k, result.value);
      else nextErrors[k] = errorMessage(result.reason, 'Unable to load.');
    });
    setData((prev) => ({ ...prev, ...next }));
    setErrors(nextErrors);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Every moderation action goes through here: one in flight at a time, toast on result, then refresh.
  const act = async (key: string, request: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await request();
      toast.success(message);
      await load();
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Action failed'));
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const patch = (key: string, path: string, body: Record<string, unknown>, message: string) =>
    act(key, () => apiPatch(path, body), message).catch(() => {});
  const actions: AdminActions = { busy, act, patch, setConfirm, setGrant };

  const {
    stats,
    users,
    jobs,
    reviews,
    verifications,
    reports,
    logs,
    subscriptions,
    bookings,
    attempts,
    billingEvents,
  } = data;
  const pendingJobs = useMemo(() => jobs.filter((j) => j.status === 'pending'), [jobs]);
  const pendingVerifications = useMemo(() => verifications.filter((v) => v.status === 'pending'), [verifications]);
  const openReports = useMemo(() => reports.filter((r) => r.status === 'open'), [reports]);
  const failedCount = Object.keys(errors).length;
  const retry = () => void load();

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 sticky top-0 bg-slate-950/95 backdrop-blur z-20">
        <div className="max-w-[1500px] mx-auto px-4 md:px-6 py-3 md:py-4 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck aria-hidden="true" className="text-violet-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-bold">Verse Trust &amp; Operations</div>
              <div className="hidden sm:block text-xs text-slate-400">
                Moderation, verification, marketplace health &amp; audit
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="hidden lg:inline">{user?.email}</span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/tester">Live Tester</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy === 'reindex'}
              onClick={() => act('reindex', () => apiPost('/admin/search/reindex'), 'Search reindexed').catch(() => {})}
            >
              <RefreshCw aria-hidden="true" size={15} className="mr-2" />
              Reindex<span className="hidden sm:inline">&nbsp;search</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh dashboard"
              title="Refresh dashboard"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden="true" size={16} className={loading ? 'motion-safe:animate-spin' : ''} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await logout();
                nav('/');
              }}
            >
              <LogOut aria-hidden="true" size={16} />
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-[1500px] mx-auto px-4 md:px-6 py-8">
        <div className="mb-7">
          <h1 className="text-3xl font-bold">Marketplace health</h1>
          <p className="text-slate-400 mt-1">
            The admin job is not content approval alone. It is trust, quality, fraud prevention and marketplace
            liquidity.
          </p>
        </div>
        {failedCount > 0 && !loading && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" size={16} />
              {failedCount} of {Object.keys(SOURCES).length} panels could not load. The rest of the console is up to
              date.
            </span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 md:gap-4 mb-8">
          <Stat label="Users" value={stats.users} icon={Users} hasError={!!errors.stats} />
          <Stat label="Live opportunities" value={stats.liveJobs} icon={Briefcase} hasError={!!errors.stats} />
          <Stat label="Applications" value={stats.applications} icon={FileText} hasError={!!errors.stats} />
          <Stat label="Hires" value={stats.hires} icon={UserCheck} hasError={!!errors.stats} />
          <Stat label="Open reports" value={stats.openReports} icon={Flag} hasError={!!errors.stats} />
          <Stat label="Bookings" value={stats.bookings} icon={Activity} hasError={!!errors.stats} />
          <Stat label="Paid plans" value={stats.activeSubscriptions} icon={ShieldCheck} hasError={!!errors.stats} />
        </div>
        <Tabs defaultValue="queue">
          <TabsList className="bg-white/5 border border-white/10 flex flex-wrap justify-start h-auto w-full md:w-auto gap-1 p-1">
            <TabsTrigger value="queue" className="flex-none">
              Opportunity queue ({errors.jobs ? '!' : pendingJobs.length})
            </TabsTrigger>
            <TabsTrigger value="verification" className="flex-none">
              Verification ({errors.verifications ? '!' : pendingVerifications.length})
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex-none">
              Reports ({errors.reports ? '!' : openReports.length})
            </TabsTrigger>
            <TabsTrigger value="users" className="flex-none">
              Users
            </TabsTrigger>
            <TabsTrigger value="reviews" className="flex-none">
              Reviews ({errors.reviews ? '!' : reviews.filter((r) => r.status === 'pending').length})
            </TabsTrigger>
            <TabsTrigger value="signin" className="flex-none">
              Sign-in doctor
            </TabsTrigger>
            <TabsTrigger value="commerce" className="flex-none">
              Commerce
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex-none">
              Operations
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex-none">
              Audit
            </TabsTrigger>
            <TabsTrigger value="demo" className="flex-none">
              Demo data
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-3 mt-5">
            <Suspense fallback={null}>
              <QueueTab jobs={pendingJobs} error={errors.jobs} loading={loading} retry={retry} actions={actions} />
            </Suspense>
          </TabsContent>

          <TabsContent value="verification" className="space-y-3 mt-5">
            <Suspense fallback={null}>
              <VerificationTab
                verifications={pendingVerifications}
                error={errors.verifications}
                loading={loading}
                retry={retry}
                actions={actions}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="reports" className="space-y-3 mt-5">
            <Suspense fallback={null}>
              <ReportsTab
                reports={openReports}
                error={errors.reports}
                loading={loading}
                retry={retry}
                flaggedMessages={stats.flaggedMessages ?? 0}
                flaggedMessagesAvailable={!errors.stats}
                actions={actions}
                onReview={setReviewing}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="users" className="space-y-3 mt-5">
            <Suspense fallback={null}>
              <UsersTab users={users} error={errors.users} loading={loading} retry={retry} actions={actions} />
            </Suspense>
          </TabsContent>

          <TabsContent value="reviews" className="space-y-3 mt-5">
            <Suspense fallback={null}>
              <ReviewsTab reviews={reviews} error={errors.reviews} loading={loading} retry={retry} actions={actions} />
            </Suspense>
          </TabsContent>

          <TabsContent value="signin" className="mt-5">
            <Suspense fallback={null}>
              <SignInDoctorTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="commerce" className="mt-5">
            <Suspense fallback={null}>
              <CommerceTab
                attempts={attempts}
                billingEvents={billingEvents}
                subscriptions={subscriptions}
                bookings={bookings}
                errors={{
                  attempts: errors.attempts,
                  billingEvents: errors.billingEvents,
                  subscriptions: errors.subscriptions,
                  bookings: errors.bookings,
                }}
                loading={loading}
                retry={retry}
                actions={actions}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="operations" className="mt-5">
            <Suspense fallback={null}>
              <OperationsTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="demo" className="mt-5">
            <Suspense fallback={null}>
              <DemoDataTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="audit" className="mt-5">
            <Suspense fallback={null}>
              <AuditTab logs={logs} error={errors.logs} loading={loading} retry={retry} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </main>
      <ConfirmDialog value={confirm} onClose={() => setConfirm(null)} />
      <ReportReview
        reportId={reviewing}
        onClose={() => setReviewing(null)}
        onDecided={async (message) => {
          toast.success(message);
          await load();
        }}
      />
      <GrantPlanDialog
        value={grant}
        busy={!!busy}
        onClose={() => setGrant(null)}
        onGrant={(g, planCode, days) =>
          act(
            `grant:${g.id}`,
            () => apiPost(`/admin/users/${g.id}/grant-plan`, { planCode, days }),
            `${planCode} plan granted to ${g.name} for ${days} days`,
          )
        }
      />
    </div>
  );
}
