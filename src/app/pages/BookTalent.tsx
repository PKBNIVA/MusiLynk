import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ActSearchForm } from '../components/ActSearchForm';
import { ActCard } from '../components/talent/ActCard';
import { useHomeCityDefault } from '../components/talent/useHomeCity';
import { LoadMore } from '../components/LoadMore';
import { NoResults, SearchNotice } from '../components/SearchFeedback';
import { usePagedList, type PageMeta } from '../lib/usePagedList';
import { useUrlFilters } from '../lib/useUrlFilters';
import { Field, FormDialog, textareaClass } from '../components/booking/BookingDialogs';
import { Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, errorStatus } from '../lib/errors';
import type { Act } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';
import { formatInputEcho } from '../lib/format';

type ActPage = PageMeta & { acts?: Act[] };
type BookingLimits = { activeAllowed: number; activeUsed: number; planName?: string };
const pickActs = (page: ActPage) => page.acts;
const FILTERS = ['q', 'city', 'type', 'member'] as const;
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
  /** The act's id, or the musician's own when they front no act (then `direct` is set). */
  id: string;
  direct?: boolean;
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
  const member = filters.member;
  // Coming from a musician's profile (?member=) or an act page (?act=) the city must not narrow the list.
  const { city: homeCity, ready } = useHomeCityDefault('city', Boolean(params.get('member') || params.get('act')));
  const [booking, setBooking] = useState<Enquiry | null>(null),
    [formError, setFormError] = useState(''),
    [sending, setSending] = useState(false);
  const preselected = useRef<string | null>(null);
  // The plan's room for active enquiries, shown before anything is typed (J-25).
  const [limits, setLimits] = useState<BookingLimits | null>(null);
  const loadLimits = useCallback(() => {
    apiGet<Partial<BookingLimits>>('/bookings/limits')
      .then((d) =>
        setLimits(
          typeof d.activeAllowed === 'number' && typeof d.activeUsed === 'number' ? (d as BookingLimits) : null,
        ),
      )
      .catch(() => setLimits(null));
  }, []);
  useEffect(loadLimits, [loadLimits]);
  const atLimit = Boolean(limits && limits.activeUsed >= limits.activeAllowed);
  // A musician who fronts no act can still be asked for a quote (A-09): their name for the form.
  const [musician, setMusician] = useState<{ id: string; name: string } | 'missing' | null>(null);

  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    if (ready) void load();
  }, [ready, query, load]);

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

  // From a musician's profile (?member=): a single act they front opens its enquiry straight away.
  const memberOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!member || loading || loadError || acts.length !== 1 || memberOpened.current === member) return;
    memberOpened.current = member;
    openEnquiry(acts[0]);
  }, [member, loading, loadError, acts, openEnquiry]);

  const directOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!member || loading || loadError || acts.length > 0 || directOpened.current === member) return;
    directOpened.current = member;
    apiGet<{ professional?: { id: string; name: string; location?: string | null } }>(
      `/public/talent/${encodeURIComponent(member)}`,
    )
      .then((d) => {
        const person = d.professional;
        if (!person) throw new Error('missing');
        if (userId && person.id === userId) throw new Error('self');
        setMusician({ id: person.id, name: person.name });
        setFormError('');
        setBooking({
          id: person.id,
          direct: true,
          name: person.name,
          eventType: 'wedding',
          eventDate: '',
          eventCity: city || person.location || '',
          venueName: '',
          budgetMin: '',
          budgetMax: '',
          requirements: '',
        });
      })
      .catch(() => setMusician('missing'));
  }, [member, loading, loadError, acts.length, userId, city]);

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
        ...(booking.direct ? { musicianId: booking.id } : { actId: booking.id }),
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
      loadLimits();
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
        {limits && (
          <p
            id="booking-limit"
            data-testid="booking-limit"
            className={`mb-4 text-sm ${atLimit ? 'text-amber-200' : 'text-slate-400'}`}
          >
            {limits.planName || 'Your'} plan: {limits.activeUsed} of {limits.activeAllowed} active enquiries
            {atLimit && (
              <>
                {' '}
                — upgrade to send more.{' '}
                <Link to={`${base}/billing`} className="font-semibold underline underline-offset-4">
                  See plans
                </Link>
              </>
            )}
          </p>
        )}
        <ActSearchForm
          idPrefix="book-acts"
          values={filters}
          busy={loading}
          onSearch={(changes) => {
            if (!update(changes)) void load();
          }}
          onType={(type) => update({ type })}
        />
        {homeCity && !member && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="City">
            {[
              { label: homeCity, pressed: city.toLowerCase() === homeCity.toLowerCase(), city: homeCity },
              { label: 'All cities', pressed: !city, city: '' },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                aria-pressed={chip.pressed}
                onClick={() => update({ city: chip.city })}
                className={`min-h-9 rounded-full border px-3.5 text-sm ${
                  chip.pressed
                    ? 'border-violet-400 bg-violet-500/20 text-white'
                    : 'border-white/15 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {member && (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 text-sm text-slate-300" data-testid="member-filter">
            Showing the acts this musician fronts.
            <button
              type="button"
              className="text-violet-300 hover:text-violet-200"
              onClick={() => update({ member: '' })}
            >
              Show all acts
            </button>
          </p>
        )}
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
        ) : acts.length === 0 && member ? (
          musician && musician !== 'missing' ? (
            <div
              className="mt-7 rounded-xl border border-white/10 bg-white/[.04] p-8 text-center"
              data-testid="direct-quote"
            >
              <p className="font-medium">{musician.name} has no act listed yet, but you can still ask for a quote.</p>
              <p className="mt-1 text-sm text-slate-400">
                Tell them the date and your budget. They reply with a price.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button
                  disabled={atLimit}
                  aria-describedby={atLimit ? 'booking-limit' : undefined}
                  onClick={() => {
                    setFormError('');
                    setBooking({
                      id: musician.id,
                      direct: true,
                      name: musician.name,
                      eventType: 'wedding',
                      eventDate: '',
                      eventCity: city || '',
                      venueName: '',
                      budgetMin: '',
                      budgetMax: '',
                      requirements: '',
                    });
                  }}
                >
                  Request a quote
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/professionals/${encodeURIComponent(member)}`}>Back to profile</Link>
                </Button>
              </div>
            </div>
          ) : musician === 'missing' ? (
            <div className="mt-7 rounded-xl border border-dashed border-white/15 p-8 text-center" role="status">
              <p className="font-medium">This musician is not taking enquiries right now.</p>
              <p className="mt-1 text-sm text-slate-400">Browse other acts, or go back to their profile.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button asChild>
                  <Link to={`/professionals/${encodeURIComponent(member)}`}>Back to profile</Link>
                </Button>
                <Button variant="outline" onClick={() => update({ member: '' })}>
                  Browse all acts
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-center py-16" role="status">
              Loading…
            </p>
          )
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
                  return (
                    <ActCard
                      key={a.id}
                      act={a}
                      index={index}
                      to={`/acts/${a.id}`}
                      nameSuffix={ambiguous ? a.ownerName : undefined}
                      footer={
                        <>
                          <div className="flex gap-2">
                            <Button
                              className="flex-1 tap-target-44"
                              disabled={atLimit}
                              aria-describedby={atLimit ? 'booking-limit' : undefined}
                              onClick={() => openEnquiry(a)}
                            >
                              <Calendar size={16} className="mr-2" />
                              Request availability
                            </Button>
                            <Button asChild variant="outline" className="tap-target-44">
                              <Link to={`/acts/${a.id}`} aria-label={`View ${a.name}`}>
                                View
                              </Link>
                            </Button>
                          </div>
                          {own && <p className="mt-2 text-xs text-slate-500">This is one of your acts.</p>}
                        </>
                      }
                    />
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
          title={
            booking?.direct ? `Request a quote from ${booking.name}` : `Enquire for ${booking?.name || 'this act'}`
          }
          description="No payment is taken until you accept a quote."
          submitLabel={booking?.direct ? 'Request quote' : 'Send enquiry'}
          canSubmit={!atLimit}
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
                <Field label="Event date" htmlFor="enquiry-date" hint={formatInputEcho(booking.eventDate)}>
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
