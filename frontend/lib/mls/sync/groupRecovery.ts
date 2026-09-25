import type { GroupSessionFactory } from '../contract/client';
import type { ConversationId } from '../contract/types';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import { UnreadableRecordError } from '../storage/mlsEncryptedStore';
import type { GroupProblemTracker } from './groupProblems';
import type { RecoveryCooldown } from './recoveryCooldown';
import type { SelfJoiner } from './selfJoiner';

export interface GroupRecoveryHost {
  runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T>;
  /** Erases every local trace of the group; call inside runExclusive. */
  forgetLocked(conversationId: ConversationId): Promise<void>;
}

/** Bounded repairs for a group this device has no usable saved state for. */
export class GroupRecovery {
  constructor(
    private readonly host: GroupRecoveryHost,
    private readonly factory: GroupSessionFactory,
    private readonly storage: GroupSessionStorage,
    private readonly groupProblems: GroupProblemTracker,
    private readonly cooldown: RecoveryCooldown,
    private readonly selfJoiner: SelfJoiner,
  ) {}

  recoverMissingGroup(conversationId: ConversationId): Promise<boolean> {
    return this.selfJoiner.recoverMissingGroup(conversationId);
  }

  /** If saved state is still unreadable, wipes that one group's local copy and self-joins; true when a retry is worthwhile. */
  async recoverUnreadableGroup(conversationId: ConversationId): Promise<boolean> {
    if (this.groupProblems.get(conversationId)?.kind !== 'state-unreadable') return false;

    // Probe and wipe under one lock, so another tab cannot save a readable copy in between
    const outcome = await this.host.runExclusive(conversationId, async () => {
      if (await this.isSavedStateReadable(conversationId)) {
        this.groupProblems.clear(conversationId);
        return 'readable';
      }
      if (this.cooldown.remainingMs(conversationId) > 0) return 'cooling-down';

      await this.host.forgetLocked(conversationId);
      return 'wiped';
    });
    if (outcome !== 'wiped') return outcome === 'readable';

    // The problem stays flagged until the rejoin succeeds; the cooldown starts here
    return this.selfJoiner.recoverMissingGroup(conversationId, { replacingUnreadable: true });
  }

  /** Milliseconds until another recovery try is allowed for this group; 0 when one is allowed now. */
  waitMs(conversationId: ConversationId): number {
    return this.cooldown.remainingMs(conversationId);
  }

  /** True when the saved copy (if any) loads and restores. */
  private async isSavedStateReadable(conversationId: ConversationId): Promise<boolean> {
    let stateBytes: Uint8Array | undefined;
    try {
      stateBytes = await this.storage.load(conversationId);
    } catch (error) {
      if (error instanceof UnreadableRecordError) return false;
      throw error;
    }
    if (!stateBytes) return true;

    try {
      await this.factory.restore(conversationId, stateBytes);
      return true;
    } catch {
      return false;
    }
  }
}
