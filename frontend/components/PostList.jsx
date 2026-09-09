"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiCornerUpLeft,
  FiEye,
  FiHeart,
  FiMessageCircle,
  FiSend,
  FiUserPlus,
} from "react-icons/fi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";
import { artTones, glyph } from "./constants";

function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  const hours = Math.max(1, Math.floor((Date.now() - date.valueOf()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function CommentItem({ comment }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useCurrentUser();
  const router = useRouter();
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const replies = useQuery({
    ...queries.replies(comment.id),
    enabled: repliesOpen && Boolean(comment.id),
  });
  const createReply = useMutation({
    mutationFn: () => api.createReply(comment.id, reply.trim()),
    onSuccess: async () => {
      setReply("");
      setReplying(false);
      setRepliesOpen(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.replies(comment.id) });
    },
  });

  const startReply = () => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    setReplying(true);
  };

  return (
    <article className="post-comment">
      <div className="post-comment-head">
        <b>{comment.author?.name || "GachaHub user"}</b>
        <small>{relativeTime(comment.createdAt)}</small>
      </div>
      <p>{comment.content}</p>
      <div className="post-comment-actions">
        <button onClick={startReply} type="button">
          <FiCornerUpLeft /> Reply
        </button>
        {comment.replyCount > 0 && (
          <button onClick={() => setRepliesOpen((open) => !open)} type="button">
            {repliesOpen ? "Hide replies" : `View ${comment.replyCount} replies`}
          </button>
        )}
      </div>
      {replying && (
        <form
          className="post-reply-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (reply.trim()) createReply.mutate();
          }}
        >
          <input
            aria-label={`Reply to ${comment.author?.name || "comment"}`}
            maxLength={2000}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Write a reply..."
            value={reply}
          />
          <button disabled={!reply.trim() || createReply.isPending} type="submit">
            <FiSend />
          </button>
        </form>
      )}
      {createReply.isError && (
        <small className="post-action-error">{createReply.error.message}</small>
      )}
      {repliesOpen && (
        <div className="post-replies">
          {replies.isLoading && <small>Loading replies...</small>}
          {replies.isError && <small className="post-action-error">Could not load replies.</small>}
          {(replies.data?.items || []).map((item) => (
            <div className="post-reply" key={item.id}>
              <b>{item.author?.name || "GachaHub user"}</b>
              <p>{item.content}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function PostMedia({ media, title }) {
  if (!media.length) return null;

  return (
    <div className={`post-media-grid media-count-${Math.min(media.length, 4)}`}>
      {media.map((item) =>
        item.mediaType === "VIDEO" ? (
          <video controls key={item.id || item.url} preload="metadata">
            <source src={item.url} type={item.format ? `video/${item.format}` : undefined} />
            Your browser does not support this video.
          </video>
        ) : (
          <img
            alt={item.altText || `${title} attachment`}
            height={item.height || undefined}
            key={item.id || item.url}
            loading="lazy"
            src={item.url}
            width={item.width || undefined}
          />
        ),
      )}
    </div>
  );
}

export function PostItem({ post, index = 0, detail = false }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useCurrentUser();
  const [threadOpen, setThreadOpen] = useState(detail);
  const [comment, setComment] = useState("");
  const [likeOverride, setLikeOverride] = useState(null);
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const media = Array.isArray(post.media) ? post.media : [];
  const liked = likeOverride?.liked ?? Boolean(post.likedByCurrentUser);
  const likeCount = likeOverride?.likeCount ?? Number(post.likeCount || 0);
  const canFollow = Boolean(post.authorId && post.authorId !== user?.id);
  const followStatus = useQuery({
    ...queries.followStatus(post.authorId),
    enabled: detail && isAuthenticated && canFollow,
  });
  const comments = useQuery({
    ...queries.comments(post.id),
    enabled: threadOpen && Boolean(post.id),
  });

  const requireAuth = () => {
    if (isAuthenticated) return true;
    router.push("/login");
    return false;
  };

  const toggleLike = useMutation({
    mutationFn: () => (liked ? api.unlikePost(post.id) : api.likePost(post.id)),
    onMutate: () => {
      const previous = { liked, likeCount };
      setLikeOverride({
        liked: !liked,
        likeCount: Math.max(0, likeCount + (liked ? -1 : 1)),
      });
      return previous;
    },
    onError: (_error, _variables, previous) => {
      setLikeOverride(previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
      setLikeOverride(null);
    },
  });

  const toggleFollow = useMutation({
    mutationFn: () =>
      followStatus.data?.following
        ? api.unfollowUser(post.authorId)
        : api.followUser(post.authorId),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.followStatus(post.authorId), result),
  });

  const createComment = useMutation({
    mutationFn: () => api.createComment(post.id, comment.trim()),
    onSuccess: async () => {
      setComment("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.comments(post.id) });
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  return (
    <article className={`post ${detail ? "post-detail-card" : ""}`}>
      {!detail && <span className="rank">{index + 1}</span>}
      <div className={`post-thumb art-${artTones[index % artTones.length]}`}>{glyph.sparkle}</div>
      <Link className="post-content-link" href={`/post/${encodeURIComponent(post.id)}`}>
        <b>{post.title}</b>
        <small>
          {post.gameName ? `${post.gameName} - ` : ""}
          {post.author} - {post.time}
        </small>
      </Link>
      <span className="tag">{post.tag}</span>
      {(post.content || media.length > 0) && (
        <div className={`post-body ${detail ? "full" : ""}`}>
          {post.content && <p>{post.content}</p>}
          {media.length > 0 && (
            <div
              className={`post-media-wrap ${post.isSpoiler && !spoilerRevealed ? "hidden" : ""}`}
            >
              <PostMedia media={detail ? media : media.slice(0, 4)} title={post.title} />
              {post.isSpoiler && !spoilerRevealed && (
                <button
                  className="post-spoiler-cover"
                  onClick={() => setSpoilerRevealed(true)}
                  type="button"
                >
                  <FiEye /> Reveal spoiler
                </button>
              )}
            </div>
          )}
          {!detail && (
            <Link className="post-read-more" href={`/post/${encodeURIComponent(post.id)}`}>
              Open post
            </Link>
          )}
        </div>
      )}
      <div className="post-social" aria-label={`Actions for ${post.title}`}>
        <button
          aria-pressed={liked}
          className={liked ? "active" : ""}
          disabled={toggleLike.isPending}
          onClick={() => requireAuth() && toggleLike.mutate()}
          type="button"
        >
          <FiHeart /> {likeCount}
        </button>
        <button
          aria-expanded={threadOpen}
          onClick={() => setThreadOpen((open) => !open)}
          type="button"
        >
          <FiMessageCircle /> {post.commentCount || 0}
        </button>
        {detail && canFollow && (
          <button
            aria-pressed={Boolean(followStatus.data?.following)}
            className={followStatus.data?.following ? "active" : ""}
            disabled={followStatus.isLoading || toggleFollow.isPending}
            onClick={() => requireAuth() && toggleFollow.mutate()}
            type="button"
          >
            <FiUserPlus /> {followStatus.data?.following ? "Following" : "Follow"}
          </button>
        )}
      </div>
      {(toggleLike.isError || toggleFollow.isError) && (
        <small className="post-action-error">Could not update this post. Try again.</small>
      )}
      {threadOpen && (
        <section className="post-thread" aria-label={`Comments on ${post.title}`}>
          {comments.isLoading && <small>Loading comments...</small>}
          {comments.isError && (
            <small className="post-action-error">Could not load comments.</small>
          )}
          {(comments.data?.items || []).map((item) => (
            <CommentItem comment={item} key={item.id} />
          ))}
          {!comments.isLoading && !comments.isError && !comments.data?.items?.length && (
            <small>No comments yet.</small>
          )}
          {isAuthenticated ? (
            <form
              className="post-comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (comment.trim()) createComment.mutate();
              }}
            >
              <input
                aria-label={`Comment on ${post.title}`}
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add a comment..."
                value={comment}
              />
              <button disabled={!comment.trim() || createComment.isPending} type="submit">
                <FiSend /> Send
              </button>
            </form>
          ) : (
            <button className="post-sign-in" onClick={() => router.push("/login")} type="button">
              Sign in to comment
            </button>
          )}
          {createComment.isError && (
            <small className="post-action-error">{createComment.error.message}</small>
          )}
        </section>
      )}
    </article>
  );
}

export function PostList({ posts }) {
  return (
    <div className="post-list">
      {posts.map((post, index) => (
        <PostItem index={index} key={post.id} post={post} />
      ))}
    </div>
  );
}
