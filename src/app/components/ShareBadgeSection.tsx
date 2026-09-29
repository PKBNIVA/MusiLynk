import { toast } from 'sonner';
import { Download, Link2, MessageCircleMore } from 'lucide-react';
import { Button } from './ui/button';
import { BACKEND_ORIGIN } from '../lib/api';
import { track } from '../lib/analytics';

/**
 * "Share your badge" — shown on the musician's profile once verified (ShareCard,
 * ShareCardsController). Consent (`profile.shareVerificationPublicly`) is a separate toggle in
 * profile settings; this section itself just needs `verified` to render.
 */
export function ShareBadgeSection({ userId }: { userId: string }) {
  const profileUrl = `${window.location.origin}/professionals/${userId}`;
  const storyCardUrl = `${BACKEND_ORIGIN}/share-cards/verified/${userId}.svg`;
  const whatsappText = encodeURIComponent(`I'm verified on Verse — ${profileUrl}`);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(profileUrl);
      toast.success('Profile link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  function trackDownload() {
    track('share_card_download');
  }

  function trackWhatsapp() {
    track('share_whatsapp');
  }

  return (
    <section
      aria-label="Share your verified badge"
      className="mt-4 rounded-2xl border border-white/10 bg-white/[.03] p-4"
    >
      <h2 className="text-sm font-semibold text-white">Share your badge</h2>
      <p className="mt-1 text-xs text-slate-400">
        You're verified on Verse — share the story card on Instagram or WhatsApp to reach more work.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="border-white/15 text-slate-200" onClick={trackDownload}>
          <a href={storyCardUrl} download>
            <Download aria-hidden="true" size={14} />
            Download story card
          </a>
        </Button>
        <Button type="button" variant="outline" size="sm" className="border-white/15 text-slate-200" onClick={copyLink}>
          <Link2 aria-hidden="true" size={14} />
          Copy profile link
        </Button>
        <Button asChild variant="outline" size="sm" className="border-white/15 text-slate-200" onClick={trackWhatsapp}>
          <a href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
            <MessageCircleMore aria-hidden="true" size={14} />
            Share on WhatsApp
          </a>
        </Button>
      </div>
    </section>
  );
}
