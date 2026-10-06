"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiCornerUpLeft,
  FiEye,
  FiEyeOff,
  FiFlag,
  FiHeart,
  FiLink,
  FiMessageCircle,
  FiMoreHorizontal,
  FiSave,
  FiSend,
  FiShare2,
  FiUserPlus,
  FiX,
} from "react-icons/fi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDismiss } from "../hooks/useDismiss";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";
import { AvatarFace } from "./AvatarFace";
import { artTones, glyph } from "./constants";
import { MentionInput } from "./MentionInput";
import { MentionText } from "./MentionText";

function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  const hours = Math.max(1, Math.floor((Date.now() - date.valueOf()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function videoMimeType(format) {
  if (!format) return undefined;
  const normalizedFormat = format.toLowerCase().replace(/^\./, "");
  return normalizedFormat === "mov" ? "video/quicktime" : `video/${normalizedFormat}`;
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

  const submitReply = () => {
    if (!reply.trim() || createReply.isPending) return;
    createReply.mutate();
  };

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
        <span className="post-comment-author">
          <b>{comment.author?.name || "GachaHub user"}</b>
          {comment.author?.username && (
            <span className="post-comment-handle">@{comment.author.username}</span>
          )}
        </span>
        <small>{relativeTime(comment.createdAt)}</small>
      </div>
      <p>
        <MentionText content={comment.content} usernames={comment.mentions} />
      </p>
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
            submitReply();
          }}
        >
          <MentionInput
            aria-label={`Reply to ${comment.author?.name || "comment"}`}
            maxLength={2000}
            onChange={setReply}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submitReply();
            }}
            placeholder="Write a reply... use @handle to mention"
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
              <span className="post-comment-author">
                <b>{item.author?.name || "GachaHub user"}</b>
                {item.author?.username && (
                  <span className="post-comment-handle">@{item.author.username}</span>
                )}
              </span>
              <p>
                <MentionText content={item.content} usernames={item.mentions} />
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function PostMedia({ media, title, onOpenImage }) {
  if (!media.length) return null;

  return (
    <div className={`post-media-grid media-count-${Math.min(media.length, 4)}`}>
      {media.map((item) =>
        item.mediaType === "VIDEO" ? (
          <video controls key={item.id || item.url} preload="metadata">
            <source src={item.url} type={videoMimeType(item.format)} />
            Your browser does not support this video.
          </video>
        ) : (
          <button
            aria-label={`Enlarge ${item.altText || `${title} attachment`}`}
            className="post-image-button"
            key={item.id || item.url}
            onClick={() => onOpenImage(item)}
            type="button"
          >
            <img
              alt={item.altText || `${title} attachment`}
              height={item.height || undefined}
              loading="lazy"
              src={item.url}
              width={item.width || undefined}
            />
          </button>
        ),
      )}
    </div>
  );
}

export function PostItem({ post, index = 0, detail = false, variant = "compact" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useCurrentUser();
  const [threadOpen, setThreadOpen] = useState(detail);
  const [comment, setComment] = useState("");
  const [likeOverride, setLikeOverride] = useState(null);
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [expandedImage, setExpandedImage] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("UNMARKED_SPOILERS");
  const [reportDetails, setReportDetails] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss({ isOpen: menuOpen, onDismiss: closeMenu, contentRef: menuRef, triggerRef: menuTriggerRef });
  const media = Array.isArray(post.media) ? post.media : [];
  const isFeed = variant === "feed";
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
    // Derive the request from the state currently rendered on the button.
    // Unliked posts use POST; liked posts use DELETE.
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

  const reportPost = useMutation({
    mutationFn: () =>
      api.createReport({
        targetType: "POST",
        targetId: post.id,
        reasonCode: reportReason,
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
      }),
    onSuccess: () => {
      setReportOpen(false);
      setReportDetails("");
      setActionNotice("Report submitted. Thank you for helping keep the community safe.");
    },
  });

  const postUrl = () => `${window.location.origin}/post/${encodeURIComponent(post.id)}`;

  const copyPostLink = async () => {
    await navigator.clipboard.writeText(postUrl());
    setActionNotice("Post link copied.");
  };

  const sharePost = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, text: post.content || post.title, url: postUrl() });
        return;
      }
      await copyPostLink();
    } catch (error) {
      if (error?.name !== "AbortError") setActionNotice("Could not share this post. Try again.");
    }
  };

  const showUnavailable = (feature) => {
    closeMenu();
    setActionNotice(`${feature} is not available yet.`);
  };

  useEffect(() => {
    if (!expandedImage) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setExpandedImage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expandedImage]);

  return (
    <article
      className={`post ${detail ? "post-detail-card" : ""} ${isFeed ? "post-feed-card" : ""}`}
    >
      {!detail && !isFeed && <span className="rank">{index + 1}</span>}
      <div className={`post-thumb art-${artTones[index % artTones.length]}`}>
        {isFeed ? (
          <AvatarFace
            fallback={(post.author || "G").charAt(0).toUpperCase()}
            image={post.authorImage}
          />
        ) : (
          glyph.sparkle
        )}
      </div>
      <Link className="post-content-link" href={`/post/${encodeURIComponent(post.id)}`}>
        <b>{post.title}</b>
        <small>
          {post.gameName ? `${post.gameName} - ` : ""}
          {post.author} - {post.time}
        </small>
      </Link>
      <div className="post-head-actions">
        <span className="tag">{post.tag}</span>
        <div className="post-options">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`More options for ${post.title}`}
            className="post-options-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuTriggerRef}
            type="button"
          >
            <FiMoreHorizontal />
          </button>
          {menuOpen && (
            <div className="post-options-menu" ref={menuRef} role="menu">
              <button
                onClick={() => {
                  closeMenu();
                  copyPostLink().catch(() => setActionNotice("Could not copy the post link."));
                }}
                role="menuitem"
                type="button"
              >
                <FiLink /> Copy link
              </button>
              <button onClick={() => showUnavailable("Save posts")} role="menuitem" type="button">
                <FiSave /> Save
              </button>
              <button onClick={() => showUnavailable("Hide posts")} role="menuitem" type="button">
                <FiEyeOff /> Hide
              </button>
              <button
                className="danger"
                onClick={() => {
                  closeMenu();
                  if (requireAuth()) setReportOpen(true);
                }}
                role="menuitem"
                type="button"
              >
                <FiFlag /> Report
              </button>
            </div>
          )}
        </div>
      </div>
      {(detail || isFeed) && (post.content || media.length > 0) && (
        <div className={`post-body ${detail ? "full" : ""}`}>
          {post.content && <p>{post.content}</p>}
          {media.length > 0 && (
            <div
              className={`post-media-wrap ${post.isSpoiler && !spoilerRevealed ? "hidden" : ""}`}
            >
              <PostMedia
                media={detail || isFeed ? media : media.slice(0, 4)}
                onOpenImage={setExpandedImage}
                title={post.title}
              />
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
        </div>
      )}
      <div className="post-social" aria-label={`Actions for ${post.title}`}>
        <button
          aria-label={`${liked ? "Unlike" : "Like"} ${post.title}`}
          aria-pressed={liked}
          className={liked ? "active" : ""}
          disabled={toggleLike.isPending}
          onClick={() => requireAuth() && toggleLike.mutate()}
          type="button"
        >
          <FiHeart /> {likeCount}
        </button>
        <button
          aria-label={`${threadOpen ? "Hide comments on" : "Show comments on"} ${post.title}`}
          aria-expanded={threadOpen}
          onClick={() => setThreadOpen((open) => !open)}
          type="button"
        >
          <FiMessageCircle /> {post.commentCount || 0}
        </button>
        <button onClick={sharePost} type="button">
          <FiShare2 /> Share
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
      {actionNotice && (
        <div className="post-action-notice" role="status">
          {actionNotice}
          <button aria-label="Dismiss post notice" onClick={() => setActionNotice("")} type="button">
            <FiX />
          </button>
        </div>
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
              <MentionInput
                aria-label={`Comment on ${post.title}`}
                maxLength={2000}
                onChange={setComment}
                placeholder="Add a comment... use @handle to mention"
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
      {expandedImage &&
        createPortal(
          <div
            aria-label={`${post.title} image preview`}
            aria-modal="true"
            className="post-lightbox"
            onClick={() => setExpandedImage(null)}
            role="dialog"
          >
            <button
              aria-label="Close image preview"
              className="post-lightbox-close"
              onClick={() => setExpandedImage(null)}
              type="button"
            >
              <FiX />
            </button>
            <img
              alt={expandedImage.altText || `${post.title} attachment`}
              onClick={(event) => event.stopPropagation()}
              src={expandedImage.url}
            />
          </div>,
          document.body,
        )}
      {reportOpen &&
        createPortal(
          <div className="post-report-backdrop" onMouseDown={() => setReportOpen(false)}>
            <section
              aria-label={`Report ${post.title}`}
              aria-modal="true"
              className="post-report-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="post-report-head">
                <div>
                  <small>REPORT POST</small>
                  <h2>What’s wrong with this post?</h2>
                </div>
                <button aria-label="Close report dialog" onClick={() => setReportOpen(false)} type="button">
                  <FiX />
                </button>
              </div>
              <label>
                Reason
                <select onChange={(event) => setReportReason(event.target.value)} value={reportReason}>
                  <option value="UNMARKED_SPOILERS">Unmarked spoilers</option>
                  <option value="HARASSMENT">Harassment</option>
                  <option value="COMMERCIAL_SPAM">Commercial spam</option>
                  <option value="MISINFORMATION">Misinformation</option>
                  <option value="NSFW">NSFW content</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label>
                Details <span>Optional</span>
                <textarea
                  maxLength={1000}
                  onChange={(event) => setReportDetails(event.target.value)}
                  placeholder="Add context for the moderation team"
                  rows={4}
                  value={reportDetails}
                />
              </label>
              {reportPost.isError && <small className="post-action-error">{reportPost.error.message}</small>}
              <div className="post-report-actions">
                <button onClick={() => setReportOpen(false)} type="button">Cancel</button>
                <button disabled={reportPost.isPending} onClick={() => reportPost.mutate()} type="button">
                  {reportPost.isPending ? "Submitting..." : "Submit report"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </article>
  );
}

export function PostList({ posts, variant = "compact" }) {
  return (
    <div className={`post-list post-list-${variant}`}>
      {posts.map((post, index) => (
        <PostItem index={index} key={post.id} post={post} variant={variant} />
      ))}
    </div>
  );
}
