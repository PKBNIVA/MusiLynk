import { EmptyState as SceneEmptyState } from '../components/kit/EmptyState';
import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Link } from 'react-router';
import { BookmarkX } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import type { Job } from '../lib/apiTypes';
import { optionLabel } from '../components/ui/option-labels';
export default function SavedJobs() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = () => {
    setError('');
    setLoading(true);
    return apiGet<{ jobs?: Job[] }>('/saved-jobs')
      .then((d) => setJobs(d.jobs || []))
      .catch((e: unknown) => setError(errorMessage(e, 'Saved opportunities could not be loaded.')))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  async function remove(job: Job) {
    const id = job.id;
    try {
      await apiDelete(`/saved-jobs/${id}`);
      setJobs((x) => x.filter((j) => j.id !== id));
      toast.success('Removed from saved', {
        action: {
          label: 'Undo',
          onClick: () => {
            apiPost(`/saved-jobs/${id}`)
              .then(() => load())
              .catch((e: unknown) => toast.error(errorMessage(e, 'Could not restore this opportunity')));
          },
        },
      });
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not remove this opportunity'));
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-6 pt-28 pb-16">
        <PageHeader title="Saved" />
        {error ? (
          <Card className="bg-rose-500/10 border-rose-400/20" role="alert">
            <CardContent className="p-6">
              <p>{error}</p>
              <Button className="mt-3" variant="outline" onClick={() => load()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-slate-400">Loading saved opportunities…</p>
        ) : jobs.length === 0 ? (
          <SceneEmptyState
            scene="bookmark"
            title="Nothing saved yet"
            hint="Tap the bookmark on any opportunity to keep it here."
            action={{ label: 'Browse opportunities', to: '/jobseeker/jobs' }}
          />
        ) : (
          <div className="space-y-4">
            {jobs.map((j) => (
              <Card key={j.id} className="bg-white/[.055] border-white/10">
                <CardContent className="p-5 flex justify-between gap-4">
                  <Link to={`/jobseeker/jobs/${j.id}`}>
                    <Badge variant="secondary">{j.opportunity_kind || 'job'}</Badge>
                    <h2 className="font-semibold text-xl mt-2">{j.title}</h2>
                    <p className="text-violet-300">{j.company}</p>
                    <p className="text-sm text-slate-400 mt-2">
                      {j.location} · {optionLabel(j.workplace)}
                    </p>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${j.title} from saved`}
                    onClick={() => remove(j)}
                  >
                    <BookmarkX />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
