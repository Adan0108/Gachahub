import { splitMentions } from "../lib/mentions";

/** Comment text with real, pinged `@handle`s picked out in colour; any other `@word` stays plain. */
export function MentionText({ content, usernames = [] }) {
  if (!content) return null;
  if (usernames.length === 0) return content;

  const known = new Set(usernames.map((name) => name.toLowerCase()));

  return splitMentions(content, known).map((part, index) =>
    part.mention ? (
      <span className="mention" key={index}>
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}
