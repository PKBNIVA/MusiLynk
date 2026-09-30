import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ActSearchForm } from '../components/ActSearchForm';
import { LoadMore } from '../components/LoadMore';
import { NoResults, SearchNotice } from '../components/SearchFeedback';
import { usePagedList, type PageMeta } from '../lib/usePagedList';
import { useUrlFilters } from '../lib/useUrlFilters';
import { Badge } from '../components/ui/badge';
import { Field, FormDialog, textareaClass } from '../components/booking/BookingDialogs';
import { Calendar, MapPin, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, errorStatus } from '../lib/errors';
import type { Act } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';

type ActPage = PageMeta & { acts?: Act[] };
const pickActs = (page: ActPage) => page.acts;
const FILTERS = ['q', 'city', 'type'] as const;
const NOUN = ['act', 'acts'] as const;
const ACT_SUGGESTIONS = ['wedding band', 'sufi', 'jazz', 'DJ', 'singer'] as const;

const EVENT_TYPES = [
  'wedding',
  'sangeet',
  'reception',
  'corporate',
  'festival',
  'concert',
  'private-party',
  'college',
  'brand-activation',
  'other',
];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Enquiry = {
  id: string;
  name: string;
  eventType: string;
  eventDate: string;
  eventCity: string;
  venueName: string;
  budgetMin: string;
  budgetMax: string;
  requirements: string;
};

function enquiryProblem(b: Enquiry): string {
  if (!b.eventDate) return 'Choose the event date.';
  if (b.eventDate < today()) return 'The event date cannot be in the past.';
  if (!b.eventCity.trim()) return 'Add the event city.';
  for (const value of [b.budgetMin, b.budgetMax])
    if (value.trim() && !/^\d+$/.test(value.trim())) return 'Budgets must be whole numbers.';
  if (b.budgetMin.trim() && b.budgetMax.trim() && Number(b.budgetMax) < Number(b.budgetMin))
    return 'Maximum budget must be at least the minimum.';
  return '';
}

export default function BookTalent() {
  const { user } = useAuth();
  const base = `/${useLocation().pathname.split('/')[1] || 'employer'}`;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Search, city and type live in the URL (Back undoes a filter); results are paged.
  const { values: filters, query, update, clear } = useUrlFilters(FILTERS);
  const list = usePagedList<Act, ActPage>({ path: '/acts', pick: pickActs, noun: 'acts' });
  const { items: acts, loading, error: loadError } = list;
  const city = filters.city;
  const [booking, setBooking] = useState<Enquiry | null>(null),
    [formError, setFormError] = useState(''),
    [sending, setSending] = useState(false);
  const preselected = useRef<string | null>(null);

  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    void load();
  }, [query, load]);

  const openEnquiry = useCallback(
    (a: Act) => {
      setFormError('');
      setBooking({
        id: a.id,
        name: a.name,
        eventType: 'wedding',
        eventDate: '',
        eventCity: city || a.city || '',
        venueName: '',
        budgetMin: '',
        budgetMax: '',
        requirements: '',
      });
    },
    [city],
  );

  // Coming from a public act page (?act=<id>): open the enquiry for that act straight away.
  const actParam = params.get('act');
  const userId = user?.id;
  // The ref guard opens the enquiry once per act, however often the dependencies change.
  useEffect(() => {
    if (!actParam || preselected.current === actParam) return;
    preselected.current = actParam;
    apiGet<{ act?: Act }>(`/acts/${encodeURIComponent(actParam)}`)
      .then((d) => {
        const act = d.act;
        if (!act || act.status !== 'active') throw new Error('This act is not currently taking bookings.');
        if (userId && act.owner_id === userId) throw new Error('This is your own act, so it cannot be booked.');
        openEnquiry(act);
      })
      .catch((e: unknown) =>
        toast.error(
          errorStatus(e) === 404
            ? 'That act is no longer available for booking.'
            : errorMessage(e, 'Unable to open that act.'),
        ),
      );
  }, [actParam, userId, openEnquiry]);

  const closeEnquiry = () => {
    setBooking(null);
    if (params.has('act')) {
      params.delete('act');
      setParams(params, { replace: true });
    }
  };

  async function send() {
    if (!booking || sending) return;
    const problem = enquiryProblem(booking);
    if (problem) return setFormError(problem);
    setSending(true);
    setFormError('');
    try {
      await apiPost('/bookings', {
        actId: booking.id,
        eventType: booking.eventType || 'other',
        eventDate: booking.eventDate,
        city: booking.eventCity.trim(),
        venueName: booking.venueName.trim(),
        budgetMin: booking.budgetMin.trim() ? Number(booking.budgetMin) : null,
        budgetMax: booking.budgetMax.trim() ? Number(booking.budgetMax) : null,
        requirements: booking.requirements,
      });
      toast.success('Booking enquiry sent', {
        action: { label: 'View bookings', onClick: () => navigate(`${base}/bookings`) },
      });
      closeEnquiry();
    } catch (e: unknown) {
      setFormError(errorMessage(e, 'Unable to send the enquiry.'));
    } finally {
      setSending(false);
    }
  }
  const setB = (key: keyof Enquiry, value: string) =>
    setBooking((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader title="Book talent" help={<HelpCallout {...HELP.bookTalent} />} />
        <ActSearchForm
          idPrefix="book-acts"
          values={filters}
          busy={loading}
          onSearch={(changes) => {
            if (!update(changes)) void load();
          }}
          onType={(type) => update({ type })}
        />
        {!loading && !loadError && acts.length > 0 && (
          <p className="text-sm text-slate-400 mt-5" data-testid="result-count">
            {list.total} {list.total === 1 ? 'act' : 'acts'}
          </p>
        )}
        {!loading && <SearchNotice meta={list.meta} query={filters.q} />}
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading acts…
          </p>
        ) : loadError ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : acts.length === 0 ? (
          <div className="mt-7 rounded-xl border border-dashed border-white/15">
            <NoResults
              title="No acts match this search"
              noun="acts"
              query={filters.q}
              meta={list.meta}
              onSearch={(term) => update({ q: term })}
              suggestions={ACT_SUGGESTIONS}
              onClear={query ? clear : undefined}
            />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-7">
              {(() => {
                // Acts can share a display name (different owners, same act name); append the
                // owner's name in the list wherever that happens so the two are not confused.
                const nameCounts = new Map<string, number>();
                acts.forEach((a) => nameCounts.set(a.name, (nameCounts.get(a.name) || 0) + 1));
                return acts.map((a, index) => {
                  const own = Boolean(user && a.owner_id && a.owner_id === user.id);
                  const ambiguous = (nameCounts.get(a.name) || 0) > 1 && Boolean(a.ownerName);
                  const memberCount = a.members?.length || 0;
                  return (
                    <Card key={a.id} className="bg-white/[.055] border-white/10" data-list-item={index} tabIndex={-1}>
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Badge variant="secondary">{a.act_type}</Badge>
                            <h2 className="text-xl font-semibold mt-2 break-words" data-testid="act-name">
                              {a.name}
                              {ambiguous && <span className="text-slate-400 font-normal"> · {a.ownerName}</span>}
                            </h2>
                          </div>
                          {(a.verified || a.ownerVerified) && (
                            <ShieldCheck aria-label="Verified" className="text-emerald-300 shrink-0" size={18} />
                          )}
                        </div>
                        <div className="text-sm text-slate-400 mt-3 flex flex-wrap gap-x-4 gap-y-1 items-center">
                          <span className="flex gap-2 items-center">
                            <MapPin size={14} />
                            {a.city || 'Flexible location'}
                          </span>
                          {a.ownerName && <span>By {a.ownerName}</span>}
                          {memberCount > 0 && (
                            <span>
                              {memberCount} member{memberCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <div className="text-sm mt-3">
                          {(Array.isArray(a.genres) && a.genres.slice(0, 5).join(' · ')) || 'Multi-genre'}
                        </div>
                        <div className="text-sm text-emerald-300 mt-4">
                          {a.min_fee
                            ? `From ${a.currency || 'INR'} ${Number(a.min_fee).toLocaleString('en-IN')}`
                            : 'Ask for quote'}
                        </div>
                        <div className="flex gap-2 mt-5">
                          <Button className="flex-1 tap-target-44" onClick={() => openEnquiry(a)}>
                            <Calendar size={16} className="mr-2" />
                            Request availability
                          </Button>
                          <Button asChild variant="outline" className="tap-target-44">
                            <Link to={`/acts/${a.id}`} aria-label={`View ${a.name}`}>
                              View
                            </Link>
                          </Button>
                        </div>
                        {own && <p className="text-xs text-slate-500 mt-2">This is one of your acts.</p>}
                      </CardContent>
                    </Card>
                  );
                });
              })()}
            </div>
            <LoadMore
              shown={acts.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              error={list.moreError}
              onLoadMore={list.loadMore}
              noun={NOUN}
            />
          </>
        )}
        <FormDialog
          open={Boolean(booking)}
          onOpenChange={(open) => !open && closeEnquiry()}
          title={`Enquire for ${booking?.name || 'this act'}`}
          description="No payment is taken until you accept a quote."
          submitLabel="Send enquiry"
          busyLabel="Sending…"
          busy={sending}
          error={formError}
          onSubmit={send}
        >
          {booking && (
            <>
              <Field label="Event type" htmlFor="enquiry-type">
                <AppSelect
                  className="h-11 rounded-xl"
                  id="enquiry-type"
                  value={booking.eventType}
                  onValueChange={(v) => setB('eventType', v)}
                  options={EVENT_TYPES}
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Event date" htmlFor="enquiry-date">
                  <Input
                    id="enquiry-date"
                    type="date"
                    min={today()}
                    value={booking.eventDate}
                    onChange={(e) => setB('eventDate', e.target.value)}
                  />
                </Field>
                <Field label="Event city" htmlFor="enquiry-city">
                  <Input
                    id="enquiry-city"
                    value={booking.eventCity}
                    onChange={(e) => setB('eventCity', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Venue (optional)" htmlFor="enquiry-venue">
                <Input
                  id="enquiry-venue"
                  value={booking.venueName}
                  onChange={(e) => setB('venueName', e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Budget min"
                  htmlFor="enquiry-budget-min"
                  help="The range you can pay for the performance, in rupees. Acts reply faster when they can see a real budget."
                >
                  <Input
                    id="enquiry-budget-min"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={booking.budgetMin}
                    onChange={(e) => setB('budgetMin', e.target.value)}
                  />
                </Field>
                <Field label="Budget max" htmlFor="enquiry-budget-max">
                  <Input
                    id="enquiry-budget-max"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={booking.budgetMax}
                    onChange={(e) => setB('budgetMax', e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Requirements"
                htmlFor="enquiry-requirements"
                help="Set length, sound and stage you provide, dress code, song requests. Anything that changes the quote."
              >
                <textarea
                  id="enquiry-requirements"
                  className={textareaClass}
                  placeholder="Timing, audience size, songs/genre, production available, travel/accommodation…"
                  value={booking.requirements}
                  onChange={(e) => setB('requirements', e.target.value)}
                />
              </Field>
            </>
          )}
        </FormDialog>
      </main>
    </div>
  );
}
