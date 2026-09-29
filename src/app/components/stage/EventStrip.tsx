import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { fetchUpcomingEvents, icsUrlFor, type StagePost } from '../../lib/stage';
import { formatDateTime } from '../../lib/format';
import { Button } from '../ui/button';

/** "Upcoming in <city>" strip: the next 3 meetup/event posts (Stage::EventsController#index). */
export function EventStrip() {
  const [city, setCity] = useState<string | null>(null);
  const [events, setEvents] = useState<StagePost[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchUpcomingEvents()
      .then((data) => {
        if (!alive) return;
        setCity(data.city ?? null);
        setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded || events.length === 0) return null;

  return (
    <section aria-label="Upcoming events" className="mb-5 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <CalendarDays aria-hidden="true" size={16} />
        Upcoming{city ? ` in ${city}` : ''}
      </h2>
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[.03] p-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{event.event?.title}</p>
              <p className="truncate text-xs text-slate-400">
                {[event.event?.startsAt ? formatDateTime(event.event.startsAt) : null, event.event?.venue]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 border-white/15 text-slate-200">
              <a href={icsUrlFor(event.id)}>ICS</a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
