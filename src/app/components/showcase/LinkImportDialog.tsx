import { lazy, Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { WorkLinks, type WorkLink } from '../join/WorkLinks';
import { DraftingSkeleton } from '../join/DraftingSkeleton';
import { Button } from '../ui/button';
import { Sparkles } from 'lucide-react';
import { draftFromLinks, importDraftToLibrary, type DraftResult, type ProfileDraft } from '../../lib/linkImport';
import { errorMessage } from '../../lib/errors';
import type { PortfolioItem } from '../../lib/apiTypes';

const ProfileDraftReview = lazy(() => import('../join/ProfileDraftReview'));

/**
 * "Add from a link", on the Library page: the same paste box and drafting flow as the sign-up's
 * work-links step, ending in POST /api/library/import instead of filling out a sign-up.
 */
export function LinkImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (items: PortfolioItem[], suggestedReview: boolean) => void;
}) {
  const [links, setLinks] = useState<WorkLink[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [importing, setImporting] = useState(false);

  // Closing the dialog keeps what was pasted (nothing is lost by pressing Escape); the list is
  // cleared only once the links are actually added to the library, or removed one by one.
  // A preview that was still loading when the dialog closed will never report back to this list.
  useEffect(() => {
    if (open)
      setLinks((current) =>
        current.some((link) => link.loading) ? current.map((link) => ({ ...link, loading: false })) : current,
      );
  }, [open]);

  const reset = () => {
    setLinks([]);
    setDraftResult(null);
  };

  const ready = links.filter((link) => !link.loading);
  const addLinksOnly = () =>
    addToLibrary({
      headline: null,
      bio: null,
      roles: [],
      genres: [],
      instruments: [],
      city: null,
      yearsExperience: null,
      credits: [],
      items: ready.map((link) => ({ url: link.url, title: link.preview.title, caption: null })),
    });

  const runDraft = async () => {
    setDrafting(true);
    try {
      setDraftResult(await draftFromLinks(links.map((link) => link.url)));
    } catch (caught) {
      toast.error(errorMessage(caught, 'Couldn’t draft a profile from those links. Try again.'));
    } finally {
      setDrafting(false);
    }
  };

  const addToLibrary = async (draft: ProfileDraft) => {
    setImporting(true);
    try {
      const result = await importDraftToLibrary(draft);
      onImported(result.portfolioItems, !!result.suggestedReview);
      const added = result.portfolioItems.length;
      if (result.suggestedReview) toast.success('Added to your work. We suggested a new headline in Review changes.');
      else if (added === 0) toast.success('Those links are already in your work.');
      else toast.success(added === 1 ? 'Added 1 link to your work.' : `Added ${added} links to your work.`);
      onOpenChange(false);
      reset();
    } catch (caught) {
      toast.error(errorMessage(caught, 'That couldn’t be added to your work.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/15 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>Add from a link</DialogTitle>
          <DialogDescription className="text-slate-400">
            Paste a YouTube, Spotify, SoundCloud or Linktree link. We’ll draft titles and captions from it.
          </DialogDescription>
        </DialogHeader>
        <WorkLinks links={links} onChange={setLinks} />
        {links.length > 0 && !draftResult && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={addLinksOnly} disabled={importing || ready.length === 0}>
              {importing ? 'Adding…' : ready.length === 1 ? 'Add to my work' : `Add ${ready.length} links to my work`}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runDraft}
              disabled={drafting}
              className="border-violet-400/40 text-violet-100"
            >
              <Sparkles aria-hidden="true" size={16} />
              Draft my profile from these links
            </Button>
          </div>
        )}
        {drafting && <DraftingSkeleton />}
        {draftResult && (
          <Suspense fallback={<DraftingSkeleton />}>
            <ProfileDraftReview
              result={draftResult}
              onUse={addToLibrary}
              onSkip={() => setDraftResult(null)}
              useLabel={importing ? 'Adding…' : 'Add to my work'}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
