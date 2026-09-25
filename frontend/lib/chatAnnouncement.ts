export interface AnnouncementState {
  conversationId: string;
  /** undefined = not loaded yet, null = loaded and empty. */
  lastId: string | null | undefined;
  text: string;
  seq: number;
}

export interface LastMessage {
  id: string;
  senderId: string;
  contentType?: string;
}

/** Next state for the screen-reader announcement: only a new last message from someone else speaks. */
export function nextAnnouncement(
  state: AnnouncementState,
  input: {
    conversationId: string;
    /** undefined until the newest page has loaded. */
    last: LastMessage | null | undefined;
    ownUserId: string | undefined;
    senderName: string;
  },
): AnnouncementState {
  const { conversationId, last, ownUserId, senderName } = input;
  const lastId = last === undefined ? undefined : (last?.id ?? null);
  if (state.conversationId !== conversationId) {
    return { conversationId, lastId, text: "", seq: state.seq };
  }
  if (lastId === state.lastId) return state;
  const isNew = state.lastId !== undefined && last && last.senderId !== ownUserId;
  if (!isNew || last.contentType === "SYSTEM") return { ...state, lastId };
  return { ...state, lastId, text: `New message from ${senderName}`, seq: state.seq + 1 };
}
