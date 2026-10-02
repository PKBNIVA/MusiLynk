import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Link2, MessageCircle, MoreHorizontal, Share2 } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { track } from '../lib/analytics';
import { shareLink, whatsappHref, type ShareChannel, type ShareSurface } from '../lib/share';

type Props = {
  surface: ShareSurface;
  /** Canonical site path being shared, e.g. "/professionals/abc". Turned into an absolute, UTM-tagged link. */
  path: string;
  /** Builds the message around the link (see shareCopy in lib/share). */
  compose: (url: string) => string;
  /** Skip the utm_* params (the referral link already carries its own code). */
  plainUrl?: boolean;
  /** Title for the native share sheet. */
  title?: string;
  /** Visible label and accessible name context, e.g. "Share this profile". */
  label?: string;
  /** Demo/showcase content is never shared: the share pages 404 to crawlers by design. */
  demo?: boolean;
  /** ['whatsapp'] renders a single "Share on WhatsApp" link button instead of a menu. */
  channels?: ShareChannel[];
  variant?: 'outline' | 'default' | 'ghost';
  className?: string;
  testId?: string;
};

const ALL: ShareChannel[] = ['whatsapp', 'copy', 'native'];

/** One "Share" button: WhatsApp, Copy link and (where the browser has navigator.share) More…. */
export function ShareMenu({
  surface,
  path,
  compose,
  plainUrl,
  title = 'Verse',
  label = 'Share',
  demo,
  channels = ALL,
  variant = 'outline',
  className,
  testId = 'share-menu',
}: Props) {
  const [copied, setCopied] = useState(false);
  if (demo) return null;
  const hasNative = channels.includes('native') && typeof navigator !== 'undefined' && 'share' in navigator;
  const used = (channel: ShareChannel) => track('share_clicked', { surface, channel });
  const urlFor = (source: 'whatsapp' | 'copy' | 'native') => (plainUrl ? path : shareLink(path, surface, source));
  const message = compose(urlFor('whatsapp'));
  const href = whatsappHref(message);
  const copyUrl = urlFor('copy');

  if (channels.length === 1 && channels[0] === 'whatsapp')
    return (
      <Button variant={variant} size="sm" asChild className={className}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`${testId}-whatsapp`}
          onClick={() => used('whatsapp')}
        >
          <MessageCircle size={14} aria-hidden="true" className="mr-1.5" />
          Share on WhatsApp
        </a>
      </Button>
    );

  async function copy() {
    used('copy');
    try {
      await navigator.clipboard.writeText(copyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  async function nativeShare() {
    used('native');
    try {
      await navigator.share({ title, text: compose(urlFor('native')) });
    } catch {
      /* dismissed the sheet, or sharing failed: nothing to tell the person */
    }
  }

  const item = 'min-h-10 cursor-pointer gap-2 text-sm sm:min-h-8';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className={className} data-testid={testId} aria-label={label}>
          <Share2 size={14} aria-hidden="true" className="mr-1.5" />
          {label.length > 20 ? 'Share' : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-2rem)]">
        {channels.includes('whatsapp') && (
          <DropdownMenuItem asChild className={item}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`${testId}-whatsapp`}
              onClick={() => used('whatsapp')}
            >
              <MessageCircle aria-hidden="true" />
              WhatsApp
            </a>
          </DropdownMenuItem>
        )}
        {channels.includes('copy') && (
          <DropdownMenuItem className={item} onSelect={() => void copy()} data-testid={`${testId}-copy`}>
            {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            Copy link
          </DropdownMenuItem>
        )}
        {hasNative && (
          <DropdownMenuItem className={item} onSelect={() => void nativeShare()} data-testid={`${testId}-native`}>
            <MoreHorizontal aria-hidden="true" />
            More…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
