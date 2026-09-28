import { useEffect, useState } from 'react';
import { UserPlus, UserCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { errorMessage } from '../../lib/errors';
import { fetchFollowers, followActor, unfollowActor, type StageAuthorType } from '../../lib/stage';
import { useAuth } from '../../lib/authContext';

export interface FollowButtonProps {
  type: StageAuthorType;
  id: string;
  /** Known follow state to avoid a fetch when the caller already has it (e.g. from an author page). */
  initialFollowing?: boolean;
  className?: string;
  size?: 'sm' | 'default';
  onChange?: (following: boolean) => void;
}

/**
 * Follow/unfollow for any Stage identity (person, act or organization). Self-contained: fetches
 * the current state if not given one, and is safe to mount anywhere (author pages, post cards).
 * Exported for other screens (e.g. the portfolio library) to mount on their own author blocks.
 */
export function FollowButton({ type, id, initialFollowing, className, size = 'sm', onChange }: FollowButtonProps) {
  const { user, isAuthenticated } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(initialFollowing ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFollowing !== undefined) {
      setFollowing(initialFollowing);
      return;
    }
    if (!isAuthenticated) {
      setFollowing(false);
      return;
    }
    let alive = true;
    fetchFollowers(type, id)
      .then((d) => alive && setFollowing(d.following))
      .catch(() => alive && setFollowing(false));
    return () => {
      alive = false;
    };
  }, [type, id, initialFollowing, isAuthenticated]);

  if (type === 'user' && user?.id === id) return null;

  async function toggle() {
    if (!isAuthenticated) {
      toast.error('Sign in to follow on the Stage.');
      return;
    }
    setBusy(true);
    try {
      if (following) {
        const d = await unfollowActor(type, id);
        setFollowing(d.following);
        onChange?.(d.following);
      } else {
        const d = await followActor(type, id);
        setFollowing(d.following);
        onChange?.(d.following);
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={following ? 'outline' : 'default'}
      size={size}
      className={className}
      disabled={busy || following === null}
      aria-pressed={Boolean(following)}
      onClick={toggle}
    >
      {following ? <UserCheck aria-hidden="true" size={16} /> : <UserPlus aria-hidden="true" size={16} />}
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
