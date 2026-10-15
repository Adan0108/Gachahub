"use client";

import { splitLinks } from "../../lib/chat/linkify";

/** Message text with its web links made clickable; everything else, markup included, stays plain text. */
export function LinkifiedText({ text }) {
  return splitLinks(text).map((segment, index) =>
    segment.href ? (
      <a href={segment.href} key={index} rel="noopener noreferrer nofollow" target="_blank">
        {segment.text}
      </a>
    ) : (
      segment.text
    ),
  );
}
