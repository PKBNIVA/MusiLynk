import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  MoreHorizontal,
  ShieldCheck,
  Music2,
  MessageCircle,
  Repeat2,
  Sparkles,
  Radio,
  Disc3,
  Megaphone,
  Search,
  Briefcase,
  ImageOff,
  Flag,
  Pencil,
  Trash2,
  Pin,
  CalendarDays,
} from 'lucide-react';
import { UserAvatar } from '../kit/UserAvatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ReportDialog } from '../ReportDialog';
import { useConfirm } from '../booking/BookingDialogs';
import { useAuth } from '../../lib/authContext';
import { apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import {
  addApplause,
  addComment,
  authorPath,
  deleteComment,
  deletePost,
  embedPreviewFor,
  fetchComments,
  icsUrlFor,
  isOwnedByActor,
  splitHashtags,
  mediaUrlFor,
  relativeTime,
  removeApplause,
  updatePost,
  useActingAs,
  POST_KIND_LABEL,
  type PostKind,
  type StageComment,
  type StagePost,
} from '../../lib/stage';
import { Composer } from './Composer';
import type { Job, PortfolioItem } from '../../lib/apiTypes';

const KIND_ICON: Record<PostKind, typeof Music2> = {
  update: Sparkles,
  performance: Radio,
  release: Disc3,
  gig: Megaphone,
  looking_for: Search,
  job_share: Briefcase,
  portfolio_share: Music2,
  system: Sparkles,
  event: CalendarDays,
};

export interface PostCardProps {
  post: StagePost;
  onChanged?: (post: StagePost) => void;
  onDeleted?: (id: string) => void;
}

/** One Stage post: author, body, media, shared preview, applause, comments, reshare and report. */
export function PostCard({ post, onChanged, onDeleted }: PostCardProps) {
  const { user } = useAuth();
  const { active, header } = useActingAs();
  const [applauding, setApplauding] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<StageComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; id: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body || '');
  const [reshareOpen, setReshareOpen] = useState(false);
  const { ask, element: confirmDialog } = useConfirm();

  const Icon = KIND_ICON[post.kind] || Sparkles;
  const canManage = isOwnedByActor(post.author, user?.id, active);
  const canComment = post.status === 'active';

  async function toggleApplause() {
    if (applauding) return;
    setApplauding(true);
    const optimistic = {
      ...post,
      applauded: !post.applauded,
      applauseCount: post.applauseCount + (post.applauded ? -1 : 1),
    };
    onChanged?.(optimistic);
    try {
      const result = post.applauded ? await removeApplause(post.id) : await addApplause(post.id, header);
      onChanged?.({ ...post, applauded: !post.applauded, applauseCount: result.applauseCount });
    } catch (e: unknown) {
      onChanged?.(post);
      toast.error(errorMessage(e, 'Unable to update applause.'));
    } finally {
      setApplauding(false);
    }
  }

  async function loadComments() {
    setShowComments((v) => !v);
    if (comments.length || commentsLoading) return;
    setCommentsLoading(true);
    try {
      const d = await fetchComments(post.id);
      setComments(d.comments.filter((c) => c.status === 'active'));
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to load comments.'));
    } finally {
      setCommentsLoading(false);
    }
  }

  async function submitComment(body: string, parentId?: string) {
    if (!body.trim()) return;
    try {
      const { comment } = await addComment(post.id, body.trim(), parentId, header);
      setComments((prev) => [...prev, comment]);
      onChanged?.({ ...post, commentCount: post.commentCount + 1 });
      setCommentText('');
      setReplyText('');
      setReplyTo(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to post your comment.'));
    }
  }

  async function removeComment(id: string) {
    try {
      await deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
      onChanged?.({ ...post, commentCount: Math.max(0, post.commentCount - 1) });
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to delete that comment.'));
    }
  }

  async function saveEdit() {
    try {
      const { post: updated } = await updatePost(post.id, { body: editBody.trim() });
      onChanged?.(updated);
      setEditing(false);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to save changes.'));
    }
  }

  function confirmDelete() {
    ask({
      title: 'Delete this post?',
      description: 'It will no longer appear on the Stage.',
      confirmLabel: 'Delete',
      destructive: true,
      action: async () => {
        await deletePost(post.id);
        onDeleted?.(post.id);
      },
    });
  }

  const topLevelComments = comments.filter((c) => !c.parentId);
  const repliesFor = (id: string) => comments.filter((c) => c.parentId === id);
  const embed = embedPreviewFor(post.linkUrl);

  return (
    <article
      aria-labelledby={`stage-post-${post.id}-author`}
      className="verse-surface rounded-2xl border border-white/10 bg-white/[.035] p-4 md:p-5"
    >
      {post.pinned && (
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-300">
          <Pin aria-hidden="true" size={12} />
          Pinned
        </p>
      )}
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <UserAvatar id={post.author.id} name={post.author.name} photoUrl={post.author.avatar} />
          <div className="min-w-0">
            <p
              id={`stage-post-${post.id}-author`}
              className="flex items-center gap-1.5 truncate font-semibold text-white"
            >
              <Link to={authorPath(post.author)} className="hover:underline">
                {post.author.name}
              </Link>
              {post.author.verified && (
                <ShieldCheck aria-hidden="true" size={14} className="shrink-0 text-emerald-400" />
              )}
              {post.author.system && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-slate-400">
                  Verse
                </span>
              )}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <time dateTime={post.createdAt} title={formatDateTime(post.createdAt)}>
                {relativeTime(post.createdAt)}
              </time>
              <span aria-hidden="true">·</span>
              <Badge variant="secondary" className="gap-1 bg-white/10 text-slate-200">
                <Icon aria-hidden="true" size={12} />
                {POST_KIND_LABEL[post.kind]}
              </Badge>
            </p>
          </div>
        </div>
        <PostMenu
          canManage={canManage}
          onEdit={() => setEditing(true)}
          onDelete={confirmDelete}
          onReport={() => {
            setReportTarget({ type: 'post', id: post.id });
            setReportOpen(true);
          }}
        />
      </header>

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="bg-black/20 border-white/10"
            maxLength={3000}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveEdit}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        post.body && (
          <p className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-100">
            <Linkify text={post.body} />
          </p>
        )
      )}

      {post.event && <EventDetails event={post.event} postId={post.id} />}

      {post.media.length > 0 && <MediaGrid media={post.media} />}

      {embed && (
        <div className="mt-3 aspect-video overflow-hidden rounded-xl border border-white/10">
          <iframe
            src={embed.embedUrl}
            title="Linked video"
            className="size-full"
            allow="encrypted-media; picture-in-picture"
            loading="lazy"
          />
        </div>
      )}
      {!embed && post.linkUrl && (
        <a
          href={post.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block truncate rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm text-violet-300 underline"
        >
          {post.linkUrl}
        </a>
      )}

      {post.sharedEntity && <SharedEntityPreview entity={post.sharedEntity} />}

      {post.genres.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Genres">
          {post.genres.map((g) => (
            <li key={g}>
              <Badge variant="outline" className="border-white/15 text-slate-300">
                {g}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-1 border-t border-white/10 pt-3 text-sm text-slate-300">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={post.applauded}
          onClick={toggleApplause}
          disabled={applauding}
          className={post.applauded ? 'text-fuchsia-300' : ''}
        >
          <Sparkles aria-hidden="true" size={16} />
          Applause{post.applauseCount > 0 ? ` (${post.applauseCount})` : ''}
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-expanded={showComments} onClick={loadComments}>
          <MessageCircle aria-hidden="true" size={16} />
          Comment{post.commentCount > 0 ? ` (${post.commentCount})` : ''}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setReshareOpen(true)}>
          <Repeat2 aria-hidden="true" size={16} />
          Reshare{post.reshareCount > 0 ? ` (${post.reshareCount})` : ''}
        </Button>
      </div>

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          {commentsLoading && <p className="text-sm text-slate-500">Loading comments…</p>}
          {topLevelComments.map((c) => (
            <div key={c.id} className="space-y-2">
              <CommentRow
                comment={c}
                canManage={isOwnedByActor(c.author, user?.id, active) || canManage}
                onDelete={() => removeComment(c.id)}
                onReport={() => {
                  setReportTarget({ type: 'comment', id: c.id });
                  setReportOpen(true);
                }}
                onReply={() => setReplyTo(c.id)}
              />
              {repliesFor(c.id).map((r) => (
                <div key={r.id} className="ml-8">
                  <CommentRow
                    comment={r}
                    canManage={isOwnedByActor(r.author, user?.id, active) || canManage}
                    onDelete={() => removeComment(r.id)}
                    onReport={() => {
                      setReportTarget({ type: 'comment', id: r.id });
                      setReportOpen(true);
                    }}
                  />
                </div>
              ))}
              {replyTo === c.id && (
                <form
                  className="ml-8 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitComment(replyText, c.id);
                  }}
                >
                  <label className="sr-only" htmlFor={`reply-${c.id}`}>
                    Reply to {c.author.name}
                  </label>
                  <input
                    id={`reply-${c.id}`}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply…"
                    className="flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm"
                  />
                  <Button type="submit" size="sm">
                    Reply
                  </Button>
                </form>
              )}
            </div>
          ))}
          {canComment && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submitComment(commentText);
              }}
            >
              <label className="sr-only" htmlFor={`comment-${post.id}`}>
                Write a comment
              </label>
              <input
                id={`comment-${post.id}`}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm"
              />
              <Button type="submit" size="sm" disabled={!commentText.trim()}>
                Post
              </Button>
            </form>
          )}
        </div>
      )}

      <Dialog open={reshareOpen} onOpenChange={setReshareOpen}>
        <DialogContent className="bg-slate-950 text-white border-white/15 max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Reshare {post.author.name}'s post</DialogTitle>
          </DialogHeader>
          <Composer reshareOf={post.id} compact onPosted={() => setReshareOpen(false)} />
        </DialogContent>
      </Dialog>

      {reportTarget && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          title={reportTarget.type === 'post' ? 'Report this post' : 'Report this comment'}
          onSubmit={(r) => apiPost('/reports', { entityType: reportTarget.type, entityId: reportTarget.id, ...r })}
        />
      )}
      {confirmDialog}
    </article>
  );
}

function PostMenu({
  canManage,
  onEdit,
  onDelete,
  onReport,
}: {
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Post options" className="size-8 shrink-0">
          <MoreHorizontal aria-hidden="true" size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManage && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" size={14} />
            Edit
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem onSelect={onDelete} className="text-rose-300">
            <Trash2 aria-hidden="true" size={14} />
            Delete
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onReport}>
          <Flag aria-hidden="true" size={14} />
          Report
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommentRow({
  comment,
  canManage,
  onDelete,
  onReport,
  onReply,
}: {
  comment: StageComment;
  canManage: boolean;
  onDelete: () => void;
  onReport: () => void;
  onReply?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg bg-white/[.03] p-2.5">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-100">
          <Link to={authorPath(comment.author)} className="hover:underline">
            {comment.author.name}
          </Link>
        </p>
        <p className="text-slate-300">{comment.body}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          <span>{relativeTime(comment.createdAt)}</span>
          {onReply && (
            <button type="button" onClick={onReply} className="hover:text-slate-300">
              Reply
            </button>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Comment options" className="size-7 shrink-0">
            <MoreHorizontal aria-hidden="true" size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canManage && (
            <DropdownMenuItem onSelect={onDelete} className="text-rose-300">
              <Trash2 aria-hidden="true" size={14} />
              Delete
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onReport}>
            <Flag aria-hidden="true" size={14} />
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Linkify({ text }: { text: string }) {
  return (
    <>
      {splitHashtags(text).map((seg, i) =>
        seg.kind === 'hashtag' ? (
          <Link key={i} to={`/stage/tags/${encodeURIComponent(seg.value)}`} className="text-violet-300 hover:underline">
            #{seg.value}
          </Link>
        ) : (
          <span key={i}>{linkify(seg.value)}</span>
        ),
      )}
    </>
  );
}

function EventDetails({ event, postId }: { event: NonNullable<StagePost['event']>; postId: string }) {
  const when = event.startsAt ? formatDateTime(event.startsAt) : null;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5">
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <CalendarDays aria-hidden="true" size={14} />
        Event
      </p>
      {event.title && <p className="mt-1 font-semibold text-white">{event.title}</p>}
      <p className="mt-1 text-sm text-slate-300">{[when, event.venue, event.city].filter(Boolean).join(' · ')}</p>
      <div className="mt-2">
        <Button asChild variant="outline" size="sm" className="border-white/15 text-slate-200">
          <a href={icsUrlFor(postId)}>Add to calendar</a>
        </Button>
      </div>
    </div>
  );
}

function MediaGrid({ media }: { media: StagePost['media'] }) {
  return (
    <ul className={`mt-3 grid gap-1.5 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`} aria-label="Attached media">
      {media.map((m, i) => {
        const url = mediaUrlFor(m);
        return (
          <li key={`${m.uploadId}-${i}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {m.type === 'image' && url && (
              <img src={url} alt={m.caption || ''} className="max-h-96 w-full object-cover" />
            )}
            {m.type === 'audio' && url && (
              <audio controls src={url} className="w-full" aria-label={m.caption || 'Audio attachment'} />
            )}
            {!url && (
              <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
                <ImageOff aria-hidden="true" size={18} />
                {m.type === 'audio' ? 'Audio attachment' : 'Image attachment'}
              </div>
            )}
            {m.caption && <p className="px-3 py-1.5 text-xs text-slate-400">{m.caption}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function SharedEntityPreview({ entity }: { entity: NonNullable<StagePost['sharedEntity']> }) {
  if ('unavailable' in entity && entity.unavailable) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/[.02] p-3 text-sm text-slate-500">
        This {entity.type === 'job' ? 'job' : entity.type === 'portfolio_item' ? 'work sample' : 'post'} is no longer
        available.
      </div>
    );
  }
  if (entity.type === 'job') {
    const job = entity.job as Job;
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5">
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Briefcase aria-hidden="true" size={14} />
          Job
        </p>
        <p className="mt-1 font-semibold text-white">{job.title}</p>
        <p className="text-sm text-slate-400">
          {job.company} · {job.location}
        </p>
        <div className="mt-2">
          <Button asChild size="sm" disabled={!entity.applyOpen}>
            <Link to={`/opportunities/${job.id}`}>{entity.applyOpen ? 'Apply' : 'Closed'}</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (entity.type === 'portfolio_item') {
    const item = entity.item as PortfolioItem;
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5">
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Music2 aria-hidden="true" size={14} />
          Portfolio
        </p>
        <p className="mt-1 font-semibold text-white">{item.title}</p>
        {item.description && <p className="mt-1 text-sm text-slate-400">{item.description}</p>}
      </div>
    );
  }
  // Reshared post.
  const shared = entity.post as StagePost;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5">
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Repeat2 aria-hidden="true" size={14} />
        {shared.author.name}
      </p>
      {shared.body && <p className="mt-1 text-sm text-slate-200">{shared.body}</p>}
    </div>
  );
}
