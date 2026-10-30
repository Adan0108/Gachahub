type ChangedListener = (conversationId: string, messageId: string) => void;

/** Tells loaded older history (outside the query cache) that another person reacted to or edited a message it may hold. */
class MessageChangedSignal {
  private readonly listeners = new Set<ChangedListener>();

  emit(conversationId: string, messageId: string): void {
    this.listeners.forEach((listener) => listener(conversationId, messageId));
  }

  subscribe(listener: ChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const messageChangedSignal = new MessageChangedSignal();
