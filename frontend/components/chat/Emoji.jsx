"use client";

import { useState, useSyncExternalStore } from "react";
import { emojiImageUrl } from "../../lib/emoji/emojiImage";
import { isEmojiSupported } from "../../lib/emoji/emojiSupport";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const noSubscription = () => () => {};

function subscribeToReducedMotion(onChange) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** A unicode emoji: the device's own glyph when it has one, else a picture of it. */
export function Emoji({ emoji }) {
  // Server and first paint draw the text, so hydration matches; the check only ever swaps in a picture.
  const needsPicture = useSyncExternalStore(
    noSubscription,
    () => !isEmojiSupported(emoji),
    () => false,
  );
  const [pictureFailed, setPictureFailed] = useState(false);

  if (!needsPicture || pictureFailed) return <span className="emoji">{emoji}</span>;
  return (
    <img
      alt={emoji}
      className="emoji emoji-picture"
      draggable={false}
      onError={() => setPictureFailed(true)}
      src={emojiImageUrl(emoji)}
    />
  );
}

/** A custom emote: its picture (the animation unless the viewer asked for less motion), or its :shortcode: when removed. */
export function Emote({ emote }) {
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  const [pictureFailed, setPictureFailed] = useState(false);
  const label = `:${emote.shortcode}:`;
  const src = reduceMotion
    ? (emote.imageUrl ?? emote.animationUrl)
    : (emote.animationUrl ?? emote.imageUrl);

  if (emote.deletedAt) return <span className="emote-label">{label}</span>;
  if (emote.unicode && !src) return <Emoji emoji={emote.unicode} />;
  if (!src || pictureFailed) return <span className="emote-label">{label}</span>;
  return (
    <img
      alt={label}
      className="emoji emote-picture"
      draggable={false}
      onError={() => setPictureFailed(true)}
      src={src}
      title={label}
    />
  );
}

/** Whatever a reaction is made of; `choice` is { kind: "emoji", emoji } or { kind: "emote", emote }. */
export function ReactionFace({ choice }) {
  switch (choice.kind) {
    case "emote":
      return <Emote emote={choice.emote} />;
    default:
      return <Emoji emoji={choice.emoji} />;
  }
}
