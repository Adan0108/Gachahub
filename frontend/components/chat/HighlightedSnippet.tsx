import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Snippet } from "../../lib/chat/searchSnippet";

/** A search snippet with its matched parts marked. */
export function HighlightedSnippet({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  snippet.highlights.forEach((range, index) => {
    if (range.start > cursor)
      parts.push(<Fragment key={`t${index}`}>{snippet.text.slice(cursor, range.start)}</Fragment>);
    parts.push(<mark key={`m${index}`}>{snippet.text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < snippet.text.length)
    parts.push(<Fragment key="rest">{snippet.text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
