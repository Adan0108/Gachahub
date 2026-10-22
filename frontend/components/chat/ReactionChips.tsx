import { groupReactions } from "../../lib/chat/chatReactions";
import type { RawReaction, ReactionChoice } from "../../lib/chat/chatReactions";
import { ReactionFace } from "./Emoji";

/** The reactions under a message, one chip per emoji or emote with its count; yours is highlighted and a tap toggles it. */
export function ReactionChips({
  reactions,
  userId,
  onToggle,
}: {
  reactions?: RawReaction[];
  userId?: string;
  onToggle: (choice: ReactionChoice, mine: boolean) => void;
}) {
  const groups = groupReactions(reactions, userId);
  if (!groups.length) return null;
  return (
    <div className="chat-reaction-chips">
      {groups.map((group) => (
        <button
          className={group.mine ? "mine" : ""}
          key={group.key}
          onClick={() => onToggle(group.choice, group.mine)}
          type="button"
        >
          <ReactionFace choice={group.choice} /> {group.count}
        </button>
      ))}
    </div>
  );
}
