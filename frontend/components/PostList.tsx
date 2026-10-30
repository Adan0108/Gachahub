"use client";

import { FieldLimit } from "./FieldLimit";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface PostMediaRecord {
  id?: string;
  url: string;
  mediaType?: string;
  format?: string;
  altText?: string | null;
  height?: number | null;
  width?: number | null;
}
interface CommentRecord {
  id: string;
  content: string;
  author?: { id?: string; name?: string; username?: string };
  createdAt?: string;
  mentions?: string[];
  replyCount?: number;
  likeCount?: number;
  likedByCurrentUser?: boolean;
}
export interface PostRecord {
  id: string;
  title: string;
  content?: string;
  author?: string;
  authorId?: string;
  authorImage?: string | null;
  gameName?: string;
  time?: string;
  tag?: string;
  media?: PostMediaRecord[];
  likedByCurrentUser?: boolean;
  likeCount?: number;
  commentCount?: number;
  isSpoiler?: boolean;
}
type ReportTarget = "POST" | "COMMENT";
type OpenReport = (targetType?: ReportTarget, targetId?: string, label?: string) => void;
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
  FiTrash2,
  FiUserPlus,
  FiX,
} from "react-icons/fi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../hooks/useToast";
import { useDismiss } from "../hooks/useDismiss";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";
import { removePostFromCache } from "../lib/removePostFromCache";
import { ConfirmChatActionDialog } from "./chat/ConfirmChatActionDialog";
import { AvatarFace } from "./AvatarFace";
import { artTones, glyph } from "./constants";
import { MentionInput } from "./MentionInput";
import { MentionText } from "./MentionText";
import "./profile/ProfileSocial.css";
import { SharePostDialog } from "./SharePostDialog";

function relativeTime(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  const hours = Math.max(1, Math.floor((Date.now() - date.valueOf()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function videoMimeType(format?: string) {
  if (!format) return undefined;
  const normalizedFormat = format.toLowerCase().replace(/^\./, "");
  return normalizedFormat === "mov" ? "video/quicktime" : `video/${normalizedFormat}`;
}

/** A comment's author: name and handle, linking to their profile. */
function CommentAuthor({ author }: { author?: CommentRecord["author"] }) {
  const label = (
    <>
      <b>{author?.name || "GachaHub user"}</b>
      {author?.username && <span className="post-comment-handle">@{author.username}</span>}
    </>
  );
  return (
    <span className="post-comment-author">
      {author?.id ? <Link href={`/user/${encodeURIComponent(author.id)}`}>{label}</Link> : label}
    </span>
  );
}

/** Heart on a comment or reply; optimistic, rolls back if the server says no. */
function CommentLikeButton({ comment }: { comment: CommentRecord }) {
  const { isAuthenticated } = useCurrentUser();
  const router = useRouter();
  const [state, setState] = useState({
    liked: Boolean(comment.likedByCurrentUser),
    count: comment.likeCount ?? 0,
  });
  const toggle = useMutation({
    mutationFn: (like: boolean) => (like ? api.likeComment(comment.id) : api.unlikeComment(comment.id)),
    onMutate: (like) => {
      const previous = state;
      setState({ liked: like, count: Math.max(0, state.count + (like ? 1 : -1)) });
      return previous;
    },
    onError: (_error, _like, previous) => {
      if (previous) setState(previous);
    },
    onSuccess: (result: { liked: boolean; likeCount: number }) => {
      setState({ liked: result.liked, count: result.likeCount });
    },
  });

  return (
    <button
      aria-label={state.liked ? "Unlike comment" : "Like comment"}
      aria-pressed={state.liked}
      className={state.liked ? "comment-liked" : undefined}
      disabled={toggle.isPending}
      onClick={() => {
        if (!isAuthenticated) {
          router.push("/login");
          return;
        }
        toggle.mutate(!state.liked);
      }}
      type="button"
    >
      <FiHeart /> {state.count > 0 ? state.count : "Like"}
    </button>
  );
}

function CommentItem({ comment, onReport }: { comment: CommentRecord; onReport: OpenReport }) {
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
        <CommentAuthor author={comment.author} />
        <small>{relativeTime(comment.createdAt)}</small>
      </div>
      <p>
        <MentionText content={comment.content} usernames={comment.mentions} />
      </p>
      <div className="post-comment-actions">
        <CommentLikeButton comment={comment} />
        <button onClick={startReply} type="button">
          <FiCornerUpLeft /> Reply
        </button>
        <button
          onClick={() =>
            onReport("COMMENT", comment.id, `comment by ${comment.author?.name || "user"}`)
          }
          type="button"
        >
          <FiFlag /> Report comment
        </button>
        {(comment.replyCount ?? 0) > 0 && (
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
          <>
            <MentionInput
              aria-describedby={`limit-frontendcomponentsPostListtsx-0-${comment.id}`}
              aria-label={`Reply to ${comment.author?.name || "comment"}`}
              maxLength={2000}
              onChange={setReply}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                submitReply();
              }}
              placeholder="Write a reply... use @handle to mention"
              value={reply}
            />
            <FieldLimit
              id={`limit-frontendcomponentsPostListtsx-0-${comment.id}`}
              value={reply}
              max={2000}
            />
          </>
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
          {(replies.data?.items || []).map((item: CommentRecord) => (
            <div className="post-reply" key={item.id}>
              <CommentAuthor author={item.author} />
              <p>
                <MentionText content={item.content} usernames={item.mentions} />
              </p>
              <div className="post-comment-actions">
                <CommentLikeButton comment={item} />
                <button
                  onClick={() =>
                    onReport("COMMENT", item.id, `reply by ${item.author?.name || "user"}`)
                  }
                  type="button"
                >
                  <FiFlag /> Report reply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function PostMedia({
  media,
  title,
  onOpenImage,
}: {
  media: PostMediaRecord[];
  title: string;
  onOpenImage: (image: PostMediaRecord) => void;
}) {
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

export function PostItem({
  post,
  index = 0,
  detail = false,
  variant = "compact",
}: {
  post: PostRecord;
  index?: number;
  detail?: boolean;
  variant?: "compact" | "feed";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useCurrentUser();
  const [threadOpen, setThreadOpen] = useState(detail);
  const [comment, setComment] = useState("");
  const [likeOverride, setLikeOverride] = useState<{ liked: boolean; likeCount: number } | null>(
    null,
  );
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [expandedImage, setExpandedImage] = useState<PostMediaRecord | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    targetType: ReportTarget;
    targetId: string;
    label: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const { notice, showNotice } = useToast(3500);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss({
    isOpen: menuOpen,
    onDismiss: closeMenu,
    contentRef: menuRef,
    triggerRef: menuTriggerRef,
    restoreFocus: !reportOpen,
  });
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !menuTriggerRef.current) return;
    const trigger = menuTriggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    menuRef.current.style.top = `${Math.max(8, Math.min(trigger.bottom + 6, window.innerHeight - menu.height - 8))}px`;
    menuRef.current.style.left = `${Math.max(8, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 8))}px`;
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuOpen, closeMenu]);
  const media = Array.isArray(post.media) ? post.media : [];
  const isFeed = variant === "feed";
  const liked = likeOverride?.liked ?? Boolean(post.likedByCurrentUser);
  const likeCount = likeOverride?.likeCount ?? Number(post.likeCount || 0);
  const canFollow = Boolean(post.authorId && post.authorId !== user?.id);
  const canDelete = isAuthenticated && Boolean(user?.id && post.authorId === user.id);
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
      setLikeOverride(previous ?? null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
      setLikeOverride(null);
    },
  });

  const deletePost = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: async () => {
      setDeleted(true);
      setDeleteOpen(false);
      const roots = ["posts", "feed", "game-feed", "home"];
      await queryClient.cancelQueries({
        predicate: (query) => roots.includes(String(query.queryKey[0])),
      });
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            roots.includes(String(query.queryKey[0])) && query.queryKey[1] !== "detail",
        },
        (data: unknown) => removePostFromCache(data, post.id),
      );
      queryClient.removeQueries({ queryKey: queryKeys.post(post.id), exact: true });
      window.dispatchEvent(new Event("post-deleted"));
      if (detail) router.push("/");
      await queryClient.invalidateQueries({
        predicate: (query) =>
          [...roots, "community", "games", "joined-games"].includes(String(query.queryKey[0])),
      });
    },
  });

  const toggleFollow = useMutation({
    mutationFn: () =>
      followStatus.data?.following
        ? api.unfollowUser(post.authorId)
        : api.followUser(post.authorId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.followStatus(post.authorId), result);
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(post.authorId) });
    },
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
        targetType: reportTarget?.targetType || "POST",
        targetId: reportTarget?.targetId || post.id,
        reasonCode: reportReason,
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
      }),
    onSuccess: () => {
      setReportOpen(false);
      setReportDetails("");
      showNotice("Report submitted. Thank you for helping keep the community safe.");
    },
  });

  const openReport = (targetType: ReportTarget = "POST", targetId = post.id, label = post.title) => {
    if (!requireAuth()) return;
    reportPost.reset?.();
    setActionNotice("");
    setReportReason("");
    setReportDetails("");
    setReportTarget({ targetType, targetId, label });
    setReportOpen(true);
  };

  const postUrl = () => `${window.location.origin}/post/${encodeURIComponent(post.id)}`;

  const copyPostLink = async () => {
    await navigator.clipboard.writeText(postUrl());
    setActionNotice("Post link copied.");
  };

  const sharePost = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: post.title,
          text: post.content || post.title,
          url: postUrl(),
        });
        return;
      }
      await copyPostLink();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        setActionNotice("Could not share this post. Try again.");
    }
  };

  const showUnavailable = (feature: string) => {
    closeMenu();
    setActionNotice(`${feature} is not available yet.`);
  };

  useEffect(() => {
    if (!expandedImage) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedImage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expandedImage]);

  if (deleted) return null;

  return (
    <article
      className={`post ${detail ? "post-detail-card" : ""} ${isFeed ? "post-feed-card" : ""}`}
    >
      {!detail && !isFeed && <span className="rank">{index + 1}</span>}
      <div className={`post-thumb art-${artTones[index % artTones.length]}`}>
        {isFeed ? (
          <Link
            aria-label={`${post.author}'s profile`}
            className="post-author-link"
            href={`/user/${encodeURIComponent(post.authorId ?? "")}`}
          >
            <AvatarFace
              fallback={(post.author || "G").charAt(0).toUpperCase()}
              image={post.authorImage}
            />
          </Link>
        ) : (
          glyph.sparkle
        )}
      </div>
      <Link className="post-content-link" href={`/post/${encodeURIComponent(post.id)}`}>
        <b>{post.title || post.content?.slice(0, 100)}</b>
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
          {menuOpen &&
            createPortal(
              <div className="post-options-menu" ref={menuRef} role="menu">
                {canDelete && (
                  <button
                    className="danger"
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      closeMenu();
                      deletePost.reset();
                      setDeleteOpen(true);
                    }}
                  >
                    <FiTrash2 /> Delete
                  </button>
                )}
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
                    openReport();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FiFlag /> Report
                </button>
              </div>,
              document.body,
            )}
        </div>
      </div>
      {(detail || isFeed) && (post.content || media.length > 0) && (
        <div className={`post-body ${detail ? "full" : ""}`}>
          {post.content && <p>{post.content}</p>}
          {!detail && isFeed && post.content && (
            <Link className="post-read-more" href={`/post/${encodeURIComponent(post.id)}`}>
              Read full post
            </Link>
          )}
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
          aria-pressed={liked}
          className={liked ? "active" : ""}
          disabled={toggleLike.isPending}
          onClick={() => requireAuth() && toggleLike.mutate()}
          type="button"
        >
          <FiHeart /> {likeCount}
        </button>
        <button
          aria-label={`Comments on ${post.title}`}
          aria-expanded={threadOpen}
          onClick={() => setThreadOpen((open) => !open)}
          type="button"
        >
          <FiMessageCircle /> {post.commentCount || 0}
        </button>
        <button
          aria-haspopup="dialog"
          onClick={() => (isAuthenticated ? setShareOpen(true) : sharePost())}
          type="button"
        >
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
      {notice &&
        createPortal(
          <div className="toast" role="status">
            {notice}
          </div>,
          document.body,
        )}
      {actionNotice && (
        <div className="post-action-notice" role="status">
          {actionNotice}
          <button
            aria-label="Dismiss post notice"
            onClick={() => setActionNotice("")}
            type="button"
          >
            <FiX />
          </button>
        </div>
      )}
      {threadOpen && (
        <section
          id={detail ? "comments" : undefined}
          className="post-thread"
          aria-label={`Comments on ${post.title}`}
        >
          {comments.isLoading && <small>Loading comments...</small>}
          {comments.isError && (
            <small className="post-action-error">Could not load comments.</small>
          )}
          {(comments.data?.items || []).map((item: CommentRecord) => (
            <CommentItem comment={item} key={item.id} onReport={openReport} />
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
              <>
                <MentionInput
                  aria-describedby={`limit-frontendcomponentsPostListtsx-1-${post.id}`}
                  aria-label={`Comment on ${post.title}`}
                  maxLength={2000}
                  onChange={setComment}
                  placeholder="Add a comment... use @handle to mention"
                  value={comment}
                />
                <FieldLimit
                  id={`limit-frontendcomponentsPostListtsx-1-${post.id}`}
                  value={comment}
                  max={2000}
                />
              </>
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
      {shareOpen && (
        <SharePostDialog
          onClose={() => setShareOpen(false)}
          onCopyLink={copyPostLink}
          onNativeShare={
            typeof navigator !== "undefined" && "share" in navigator ? sharePost : undefined
          }
          postId={post.id}
        />
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
      <ConfirmChatActionDialog
        className="post-delete-dialog"
        isOpen={deleteOpen}
        title="Delete this post?"
        body="Your post and its comments will no longer be accessible. This cannot be undone."
        confirmLabel={deletePost.isPending ? "Deleting..." : "Delete post"}
        isPending={deletePost.isPending}
        error={
          deletePost.isError
            ? deletePost.error.message || "Could not delete this post. Try again."
            : null
        }
        onConfirm={() => {
          if (canDelete && !deletePost.isPending) deletePost.mutate();
        }}
        onClose={() => {
          if (!deletePost.isPending) setDeleteOpen(false);
        }}
      />
      {reportOpen &&
        createPortal(
          <div className="post-report-backdrop" onMouseDown={() => setReportOpen(false)}>
            <section
              aria-label={`Report ${reportTarget?.label || post.title}`}
              aria-modal="true"
              className="post-report-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !reportPost.isPending) {
                  event.stopPropagation();
                  setReportOpen(false);
                }
              }}
            >
              <div className="post-report-head">
                <div>
                  <small>REPORT {reportTarget?.targetType || "POST"}</small>
                  <h2>
                    What’s wrong with this{" "}
                    {reportTarget?.targetType === "COMMENT" ? "comment" : "post"}?
                  </h2>
                </div>
                <button
                  aria-label="Close report dialog"
                  onClick={() => setReportOpen(false)}
                  type="button"
                >
                  <FiX />
                </button>
              </div>
              <label>
                Reason
                <select
                  autoFocus
                  onChange={(event) => setReportReason(event.target.value)}
                  value={reportReason}
                >
                  <option value="" disabled>
                    Choose a reason
                  </option>
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
                <>
                  <textarea
                    aria-describedby={`limit-frontendcomponentsPostListtsx-2-${post.id}`}
                    maxLength={1000}
                    onChange={(event) => setReportDetails(event.target.value)}
                    placeholder="Add context for the moderation team"
                    rows={4}
                    value={reportDetails}
                  />
                  <FieldLimit
                    id={`limit-frontendcomponentsPostListtsx-2-${post.id}`}
                    value={reportDetails}
                    max={1000}
                  />
                </>
              </label>
              {reportPost.isError && (
                <small className="post-action-error" role="alert">
                  {(reportPost.error as Error & { status?: number })?.status === 409
                    ? "You already reported this content. It is awaiting review."
                    : "Report could not be submitted. Please try again."}
                </small>
              )}
              <div className="post-report-actions">
                <button onClick={() => setReportOpen(false)} type="button">
                  Cancel
                </button>
                <button
                  disabled={reportPost.isPending || !reportReason}
                  onClick={() => {
                    if (reportReason) reportPost.mutate();
                  }}
                  type="button"
                >
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

export function PostList({
  posts,
  variant = "compact",
}: {
  posts: PostRecord[];
  variant?: "compact" | "feed";
}) {
  return (
    <div className={`post-list post-list-${variant}`}>
      {posts.map((post, index) => (
        <PostItem index={index} key={post.id} post={post} variant={variant} />
      ))}
    </div>
  );
}
