import { base64ToBytes } from '../storage/base64';
import type { GroupSession } from '../contract/client';
import { MembershipMismatchError } from '../contract/errors';
import type { ConversationId, DeviceId, Epoch, ProcessResult } from '../contract/types';
import type { CommitVerifier } from './commitVerifier';
import { parseDeclaredMembership } from './declaredMembership';
import type { GroupProblemTracker } from './groupProblems';
import type { GroupSessionCache } from './groupSessionCache';
import type { MembershipEventLog } from './membershipEventLog';
import { deriveMembershipEvents, type MembershipEvent } from './membershipEvents';
import type { EventChange } from './pendingCommitRecovery';

export type Handshake = {
  epoch: Epoch;
  payload: string;
  membershipDeclared?: boolean;
  createdAt?: string;
};

export const handshakeTime = (handshake: Handshake): number => {
  const parsed = handshake.createdAt ? Date.parse(handshake.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const warnEventLost = (error: unknown) => console.warn('Could not save a membership notice', error);

/** Applies incoming Commits and messages to a session: checks them, flags refusals, and saves. */
export class CommitApplier {
  constructor(
    private readonly cache: Pick<GroupSessionCache, 'drop' | 'persist'>,
    private readonly verifier: CommitVerifier,
    private readonly groupProblems: GroupProblemTracker,
    private readonly deviceId: DeviceId,
    private readonly membershipEvents?: MembershipEventLog,
  ) {}

  /** Applies handshake rows in order, checks them, and saves once; any failure saves nothing and drops the cached session. */
  async applyBatch(
    conversationId: ConversationId,
    session: GroupSession,
    handshakes: Handshake[],
  ): Promise<void> {
    if (handshakes.length === 0) return;

    const events: MembershipEvent[] = [];
    try {
      for (const handshake of handshakes) {
        // eslint-disable-next-line no-await-in-loop -- must apply strictly in epoch order
        events.push(...(await this.applyHandshake(conversationId, session, handshake)));
      }

      // Commits from before membership was tracked have no roster to check against
      if (handshakes.some((handshake) => handshake.membershipDeclared)) {
        await this.verifier.assertTreeMatchesRoster(conversationId, session);
      }
    } catch (error) {
      this.cache.drop(conversationId);
      if (error instanceof MembershipMismatchError) this.noteRefusedCommit(conversationId);
      throw error;
    }

    await this.cache.persist(conversationId, session);
    await this.membershipEvents?.record(events).catch(warnEventLost);
  }

  private async applyHandshake(
    conversationId: ConversationId,
    session: GroupSession,
    handshake: Handshake,
  ): Promise<MembershipEvent[]> {
    let result: ProcessResult;
    try {
      result = await session.process(base64ToBytes(handshake.payload));
    } catch (error) {
      throw this.refusedCommit(conversationId, handshake.epoch, `MLS refused it: ${String(error)}`);
    }

    if (result.kind === 'rejected') {
      throw this.refusedCommit(
        conversationId,
        handshake.epoch,
        `this device could not apply it: ${result.reason}`,
      );
    }
    if (result.kind !== 'commit') return [];

    const problem = await this.verifier.checkCommit(
      conversationId,
      result.membershipChange,
      parseDeclaredMembership(handshake),
    );
    if (problem) {
      throw this.refusedCommit(conversationId, handshake.epoch, problem);
    }

    // Only a commit that passed every check is worth telling the user about
    return this.deriveEvents(conversationId, session, {
      change: result.membershipChange,
      epoch: result.epoch,
      at: handshakeTime(handshake),
    });
  }

  private async deriveEvents(
    conversationId: ConversationId,
    session: GroupSession,
    commit: { change: EventChange | null; epoch: Epoch; at: number },
  ): Promise<MembershipEvent[]> {
    if (!this.membershipEvents || !commit.change) return [];
    return deriveMembershipEvents({
      conversationId,
      epoch: commit.epoch,
      at: commit.at,
      change: commit.change,
      leavesAfter: await session.listLeaves(),
      ownDeviceId: this.deviceId,
    });
  }

  /** Best effort: a notice that fails to save must never break syncing. */
  async recordMembershipEvents(
    conversationId: ConversationId,
    session: GroupSession,
    commit: { change: EventChange; epoch: Epoch; at: number },
  ): Promise<void> {
    try {
      const events = await this.deriveEvents(conversationId, session, commit);
      await this.membershipEvents?.record(events);
    } catch (error) {
      warnEventLost(error);
    }
  }

  /** Flags the group: it stays refused, so the UI must say so. */
  private noteRefusedCommit(conversationId: ConversationId): void {
    this.groupProblems.mark(conversationId, 'refused-commit');
  }

  /** Every refused Commit is reported: silence here is how a group freezes with no trace. */
  private refusedCommit(
    conversationId: ConversationId,
    epoch: Epoch,
    problem: string,
  ): MembershipMismatchError {
    this.verifier.reportFault(conversationId, epoch, problem);
    return new MembershipMismatchError(conversationId, problem);
  }

  /** Applies a live wire item and saves it at once. */
  async applyIncoming(
    conversationId: ConversationId,
    session: GroupSession,
    wireBytes: Uint8Array,
  ): Promise<ProcessResult> {
    const result = await session.process(wireBytes);

    if (result.kind === 'commit') {
      // A Commit outside catch-up has no declaration to check it against, so it is always refused
      this.cache.drop(conversationId);
      this.noteRefusedCommit(conversationId);
      const problem = await this.verifier.checkCommit(
        conversationId,
        result.membershipChange,
        undefined,
      );
      throw this.refusedCommit(conversationId, result.epoch - 1, problem ?? 'it cannot be checked');
    }

    await this.cache.persist(conversationId, session);
    return result;
  }
}
