/** What the thread area shows until a conversation is picked, and while the inbox is loading. */
export function NoChatSelected() {
  return (
    <div className="chat-no-selection">
      <svg aria-hidden="true" height="92" viewBox="0 0 116 92" width="116">
        <path
          className="chat-no-selection-bubble"
          d="M42 6H74C92 6 108 20 108 40C108 60 92 74 74 74H52C49 74 46 75 44 77C41 80 37 83 32 84C34 81 35 78 35 74C20 70 8 57 8 40C8 20 24 6 42 6Z"
          fill="none"
          strokeLinejoin="round"
          strokeWidth="5"
        />
        <path
          d="M39 29v25l7-7 6 14 6-3-6-13 10-1Z"
          fill="var(--purple)"
          stroke="var(--purple)"
          strokeLinejoin="round"
          strokeWidth="3"
          transform="translate(8.5 -3.5)"
        />
      </svg>
      <b>No chats selected</b>
    </div>
  );
}
