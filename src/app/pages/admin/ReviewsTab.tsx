import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { Review } from '../../lib/apiTypes';
import { Panel, Pager, Empty, type AdminActions, type PageMeta } from './shared';

export default function ReviewsTab({
  reviews,
  error,
  loading,
  retry,
  actions,
  meta,
  onPage,
}: {
  reviews: Review[];
  error?: string;
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  const { busy, patch } = actions;
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      {reviews.length === 0 && <Empty text="No reviews yet." />}
      {reviews.map((r) => (
        <Card key={r.id} className="bg-white/[.05] border-white/10">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold">
                  {r.authorName} → {r.employerName} · {r.rating}/5
                </h2>
                <p className="text-sm text-slate-300 mt-2 break-words">{r.body}</p>
                <Badge className="mt-2">{r.status}</Badge>
              </div>
              {r.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      patch(`rev:${r.id}`, `/admin/reviews/${r.id}`, { status: 'published' }, 'Review published')
                    }
                  >
                    Publish
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      patch(`rev:${r.id}`, `/admin/reviews/${r.id}`, { status: 'rejected' }, 'Review rejected')
                    }
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <Pager meta={meta} onPage={onPage} loading={loading} />
    </Panel>
  );
}
