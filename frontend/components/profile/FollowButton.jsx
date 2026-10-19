"use client";

import { useRouter } from "next/navigation";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useFollow } from "../../hooks/profile/useFollow";
import "./ProfileSocial.css";

/** Follow, Follow back, or Following (which unfollows); for someone signed out it sends them to log in. */
export function FollowButton({ userId, isFollowing, followsYou = false, compact = false }) {
  const router = useRouter();
  const { isAuthenticated } = useCurrentUser();
  const follow = useFollow(userId);

  const label = isFollowing ? "Following" : followsYou ? "Follow back" : "Follow";
  const toggle = () => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    follow.mutate({ follow: !isFollowing });
  };

  return (
    <button
      aria-pressed={isFollowing}
      className={`follow-button ${isFollowing ? "following" : ""} ${compact ? "compact" : ""}`}
      disabled={follow.isPending}
      onClick={toggle}
      type="button"
    >
      <span className="follow-label">{label}</span>
      {isFollowing && <span className="follow-label-hover">Unfollow</span>}
    </button>
  );
}
