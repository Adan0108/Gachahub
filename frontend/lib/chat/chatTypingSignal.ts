type TypingListener = (conversationId: string, active: boolean) => void;

/**
 * Bridges the composer (mounted in app/chat/page.jsx) to the one chat socket connection (owned by
 * useChatSocket, mounted once in AppShell) - the composer pings here while the user types, and the
 * socket hook subscribes to turn that into throttled typing:start/typing:stop emits. Nothing here
 * touches the network itself; it's just an in-tab signal, no cross-tab/storage needed.
 */
class TypingSignal {
  private readonly listeners = new Set<TypingListener>();

  /** The local user is actively typing in this conversation right now. */
  ping(conversationId: string): void {
    this.emit(conversationId, true);
  }

  /** The local user stopped right away - sent the message, cleared the draft, left the conversation. */
  stop(conversationId: string): void {
    this.emit(conversationId, false);
  }

  subscribe(listener: TypingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(conversationId: string, active: boolean): void {
    this.listeners.forEach((listener) => listener(conversationId, active));
  }
}

export const typingSignal = new TypingSignal();
