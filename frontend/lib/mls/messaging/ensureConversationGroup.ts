import { EpochConflictError, GroupStateUnavailableError } from '../contract/errors';
import type { SyncEngine } from '../sync/syncEngine';
import type { ConversationId, UserId } from '../contract/types';

/**
 * Ensures a local MLS group exists for `conversationId`, creating one and
 * adding `recipientUserId` if this device has never set one up for it -
 * lets a brand-new conversation (or a message request that just got
 * accepted) get real encryption on its first send, without a separate
 * "start chat" wizard duplicating this logic.
 *
 * Safe to call before every send (it no-ops once a group exists), with one
 * accepted risk: if THIS device previously had a group here and lost the
 * local state (cleared storage, new device with no rejoin flow yet), this
 * creates a second, disconnected group instead of recovering the old one -
 * the same "lost local state" gap already accepted elsewhere (threat-model
 * §2/§5), not a new one introduced here. Fine for manual testing; a real
 * rejoin flow would need to tell the two cases apart before this is safe
 * to leave enabled unconditionally in production.
 */
export async function ensureConversationGroup(
  syncEngine: SyncEngine,
  conversationId: ConversationId,
  recipientUserId: UserId,
): Promise<void> {
  try {
    await syncEngine.getCurrentEpoch(conversationId);
    return;
  } catch (error) {
    if (!(error instanceof GroupStateUnavailableError)) {
      throw error;
    }
  }

  await syncEngine.createGroup(conversationId);
  try {
    await syncEngine.addUserToConversation(conversationId, recipientUserId);
  } catch (error) {
    // An EpochConflictError means the commit lost the race, NOT that
    // adding the recipient was rejected - SyncEngine.submitMembershipChange
    // already caught local state up to the winning commit and persisted it
    // before throwing this. Forgetting the conversation here would discard
    // that valid, resynced state and force every retry to recreate a fresh
    // local group at epoch 0 - which the server (already past epoch 0) will
    // reject again the exact same way, forever. Leaving it alone lets a
    // retry's getCurrentEpoch succeed immediately against the caught-up
    // state instead of repeating this same conflict indefinitely.
    if (!(error instanceof EpochConflictError)) {
      // createGroup succeeded but adding the recipient didn't for some
      // other reason (e.g. they haven't accepted the request yet) - without
      // this, the next attempt would see a local group already exists (from
      // the line above) and skip straight to encrypting, silently sending a
      // message only this device could ever read. Dropping it here means
      // the next call starts clean and genuinely retries adding the
      // recipient.
      await syncEngine.forgetConversation(conversationId);
    }
    throw error;
  }
}
