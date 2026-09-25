import type { ConversationId } from '../contract/types';

/** refused-commit: a Commit failed verification; state-unreadable: saved state cannot be decrypted; state-unavailable: no state and rejoining failed. */
export type GroupProblemKind = 'refused-commit' | 'state-unreadable' | 'state-unavailable';

export interface GroupProblem {
  kind: GroupProblemKind;
}

/** Per-conversation "this group is unusable on this device" status, observable by the UI. */
export class GroupProblemTracker {
  private readonly problems = new Map<ConversationId, GroupProblem>();
  private readonly listeners = new Set<() => void>();

  /** Same object until the problem changes, so it is a valid external-store snapshot. */
  get = (conversationId: ConversationId): GroupProblem | undefined =>
    this.problems.get(conversationId);

  mark(conversationId: ConversationId, kind: GroupProblemKind): void {
    if (this.problems.get(conversationId)?.kind === kind) return;
    this.problems.set(conversationId, { kind });
    this.notify();
  }

  clear(conversationId: ConversationId): void {
    if (this.problems.delete(conversationId)) this.notify();
  }

  clearAll(): void {
    if (this.problems.size === 0) return;
    this.problems.clear();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
