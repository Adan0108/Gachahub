type DeletedListener = (conversationId: string, messageId: string) => void;

/**
 * Bridges the one chat socket (useChatSocket) to loaded history that lives outside the query
 * cache (useConversationHistory's older pages): the socket hook marks the cached newest page and
 * announces the delete here, so every window that holds the message marks it too.
 */
class MessageDeletedSignal {
  private readonly listeners = new Set<DeletedListener>();

  emit(conversationId: string, messageId: string): void {
    this.listeners.forEach((listener) => listener(conversationId, messageId));
  }

  subscribe(listener: DeletedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const messageDeletedSignal = new MessageDeletedSignal();
