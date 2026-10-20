"use client";

import { LinkifiedText } from "../chat/LinkifiedText";
import { splitMentions } from "../../lib/mentions";

/** A message's text: links and emotes as before, and the handles that really pinged someone picked out in colour. */
export function CommunityText({ content, mentions = [] }) {
  if (mentions.length === 0) return <LinkifiedText text={content} />;

  const known = new Set(mentions.map((handle) => handle.toLowerCase()));
  return splitMentions(content, known).map((part, index) =>
    part.mention ? (
      <span className="mention" key={index}>
        {part.text}
      </span>
    ) : (
      <LinkifiedText key={index} text={part.text} />
    ),
  );
}
