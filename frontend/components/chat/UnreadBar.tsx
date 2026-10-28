/** Room to leave above the NEW line when scrolling to it, so this bar does not cover it. */
export const UNREAD_BAR_CLEARANCE_PX = 40;

/** "5 new messages since 09:26" over the top of the thread: click it to jump to the NEW line, or mark everything read. */
export function UnreadBar({
  count,
  since,
  onJump,
  onMarkRead,
}: {
  count: number;
  since: string;
  onJump: () => void;
  onMarkRead: () => void;
}) {
  return (
    <div className="chat-unread-bar" role="status">
      <button className="chat-unread-bar-jump" onClick={onJump} type="button">
        {count} new {count === 1 ? "message" : "messages"} since {since}
      </button>
      <button className="chat-unread-bar-read" onClick={onMarkRead} type="button">
        Mark as read
      </button>
    </div>
  );
}
