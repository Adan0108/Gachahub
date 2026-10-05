import { useMemo } from "react";
import { buildSnippet } from "../../lib/chat/searchSnippet";
import { messageDateLabel } from "../../lib/time";
import { HighlightedSnippet } from "./HighlightedSnippet";

/** One search result; its snippet is only built when the row is actually shown. */
export function SearchResultRow({ result, terms, name, active, onClick }) {
  const snippet = useMemo(() => buildSnippet(result.text, terms), [result.text, terms]);
  return (
    <li>
      <button className={active ? "chat-search-result active" : "chat-search-result"} onClick={onClick} type="button">
        <span className="chat-search-result-head">
          <b>{name}</b>
          <small>{messageDateLabel(result.createdAt)}</small>
        </span>
        <span className="chat-search-result-text">
          <HighlightedSnippet snippet={snippet} />
        </span>
      </button>
    </li>
  );
}
