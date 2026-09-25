import type { ConversationId } from '../contract/types';

// One self-join try per conversation per window, so a group that cannot be rejoined is not hammered.
export const RECOVERY_COOLDOWN_MS = 5 * 60_000;

/** When a group's last recovery try was, so every kind of recovery shares one window per conversation. */
export class RecoveryCooldown {
  private readonly startedAt = new Map<ConversationId, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until another try is allowed; 0 when one is allowed now. */
  remainingMs(conversationId: ConversationId): number {
    const last = this.startedAt.get(conversationId);
    if (last === undefined) return 0;
    return Math.max(0, RECOVERY_COOLDOWN_MS - (this.now() - last));
  }

  /** Claims the window for a try that is about to run; false when one already ran inside it. */
  tryStart(conversationId: ConversationId): boolean {
    if (this.remainingMs(conversationId) > 0) return false;
    this.startedAt.set(conversationId, this.now());
    return true;
  }

  clear(): void {
    this.startedAt.clear();
  }
}
