"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FiEye, FiEyeOff, FiPlay, FiRefreshCw } from "react-icons/fi";
import { useState } from "react";
import { postPath } from "../../lib/mls/messaging/postShareEnvelope";
import { queries } from "../../lib/queries";
import { AvatarFace } from "../AvatarFace";
import "./SharedPostCard.css";

const NOT_VISIBLE_STATUSES = new Set([401, 403, 404]);

/** The post's first picture or video, which is what the card leads with. */
function leadMedia(post) {
  return post.media.find((item) => item.url) ?? null;
}

/** A shared post: looked up live with the viewer's own access, so it can only ever show what the post really is. */
export function SharedPostCard({ postId }) {
  const post = useQuery(queries.post(postId));
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);

  if (post.isLoading) {
    return <div aria-busy="true" className="chat-shared-post loading" />;
  }

  if (post.isError) {
    const hidden = NOT_VISIBLE_STATUSES.has(post.error?.status);
    return (
      <div className="chat-shared-post unavailable" role="status">
        {hidden ? <FiEyeOff aria-hidden="true" /> : <FiRefreshCw aria-hidden="true" />}
        <b>{hidden ? "Post unavailable" : "Could not load this post"}</b>
        <small>
          {hidden
            ? "It may have been removed, or you may not have access to it."
            : "Check your connection and try again."}
        </small>
        {!hidden && (
          <button className="chat-shared-post-retry" onClick={() => post.refetch()} type="button">
            Try again
          </button>
        )}
      </div>
    );
  }

  const { data } = post;
  const media = leadMedia(data);
  const isVideo = media?.mediaType === "VIDEO";
  const covered = data.isSpoiler && !spoilerRevealed;
  const title = data.title || data.content.slice(0, 100);
  const excerpt = data.title ? data.content : "";

  return (
    <div className="chat-shared-post">
      <Link className="chat-shared-post-link" href={postPath(data.id)}>
        {media && (
          <span className={`chat-shared-post-media ${covered ? "covered" : ""}`}>
            {isVideo ? (
              <video muted playsInline preload="metadata" src={media.url} />
            ) : (
              <img alt={media.altText || ""} loading="lazy" src={media.url} />
            )}
            {isVideo && !covered && (
              <span aria-hidden="true" className="chat-shared-post-play">
                <FiPlay />
              </span>
            )}
          </span>
        )}
        <span className="chat-shared-post-author">
          <span className="chat-shared-post-avatar">
            <AvatarFace image={data.authorImage} name={data.author} />
          </span>
          <b>{data.author}</b>
        </span>
        <span className="chat-shared-post-text">
          {data.gameName && <small>{data.gameName}</small>}
          {title && <b className="chat-shared-post-title">{title}</b>}
          {excerpt && <span className="chat-shared-post-excerpt">{excerpt}</span>}
        </span>
      </Link>
      {covered && (
        <button
          className="chat-shared-post-spoiler"
          onClick={() => setSpoilerRevealed(true)}
          type="button"
        >
          <FiEye aria-hidden="true" /> Reveal spoiler
        </button>
      )}
    </div>
  );
}

/** A reply quote's small copy of a shared post: its first picture and title, or just "a post". */
export function QuotedSharedPost({ postId }) {
  const post = useQuery(queries.post(postId));
  if (!post.data) return <span>a post</span>;

  const media = leadMedia(post.data);
  const title = post.data.title || post.data.content.slice(0, 60);
  return (
    <span className="chat-reply-quote-preview">
      {media && media.mediaType !== "VIDEO" && <img alt="" src={media.url} />}
      <span className="chat-reply-quote-preview-title">{title || "a post"}</span>
    </span>
  );
}
