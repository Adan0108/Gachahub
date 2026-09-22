import { api } from '../../api';
import type { GroupSession } from '../contract/client';
import { MembershipMismatchError } from '../contract/errors';
import type { ConversationId, DeviceId, Epoch, MembershipChange } from '../contract/types';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import { describeMembershipMismatch, type DeclaredMembership } from './declaredMembership';
import { describeTreeMismatch, parseRoster } from './rosterCheck';

const DECLARED_MARKER = new Uint8Array([1]);
const declaredMarkerKey = (conversationId: ConversationId) => `${conversationId}#declared`;

/**
 * Checks a group against what the server recorded: each Commit against its
 * declared membership, and the whole tree against the roster.
 *
 * Trust model: the server is trusted as the key directory. Its attested keys
 * and roster are what everything is compared with, so these checks catch a
 * buggy or tampered client, not a malicious server that registers keys of its
 * own. Stopping that would need verification between users (safety numbers).
 */
export class CommitVerifier {
  private readonly declaredSeen = new Set<ConversationId>();
  private readonly reportedFaults = new Set<string>();

  constructor(
    private readonly storage: GroupSessionStorage,
    private readonly deviceId: DeviceId,
  ) {}

  /** Why a Commit can't be accepted, or undefined when it can. */
  async checkCommit(
    conversationId: ConversationId,
    actual: MembershipChange | null,
    declared: DeclaredMembership | undefined,
  ): Promise<string | undefined> {
    if (!declared) {
      return 'it arrived without the membership the server recorded for it, so it cannot be checked';
    }

    if (!declared.membershipDeclared) {
      // One-way per group: once a Commit was declared, a later undeclared one is a fault.
      return (await this.hasSeenDeclared(conversationId))
        ? 'the server reported it as undeclared, although earlier commits in this group were declared'
        : undefined;
    }

    const mismatch = describeMembershipMismatch(actual, declared);
    if (mismatch) return mismatch;

    await this.markDeclaredSeen(conversationId);
    return undefined;
  }

  /**
   * Throws MembershipMismatchError (and reports it) when the tree differs from the roster at its epoch.
   * To check a group before joining it by itself, pass the epoch the snapshot was for and the joining
   * device to leave out: the tree already has its leaf, the roster does not.
   */
  async assertTreeMatchesRoster(
    conversationId: ConversationId,
    session: GroupSession,
    options: { epoch?: Epoch; excludeDeviceId?: DeviceId } = {},
  ): Promise<void> {
    const epoch = options.epoch ?? (await session.currentEpoch());
    const roster = parseRoster(await api.getMlsRoster(conversationId, epoch));
    const leaves = (await session.listLeaves())?.filter(
      (leaf) => leaf.deviceId !== options.excludeDeviceId,
    );

    const problem = roster
      ? describeTreeMismatch(leaves, roster)
      : 'the server did not return a roster to check the group against';

    if (problem) {
      // The Commit that produced this epoch is the one built from the epoch before.
      this.reportFault(conversationId, epoch - 1, problem);
      throw new MembershipMismatchError(conversationId, problem);
    }
  }

  /** Best effort, once per Commit: every sync re-detects the same fault. */
  reportFault(conversationId: ConversationId, epoch: Epoch, reason: string): void {
    const key = `${conversationId}:${epoch}`;
    if (this.reportedFaults.has(key)) return;
    this.reportedFaults.add(key);

    void this.sendFault(conversationId, epoch, reason, key);
  }

  private async sendFault(
    conversationId: ConversationId,
    epoch: Epoch,
    reason: string,
    key: string,
  ): Promise<void> {
    try {
      await api.reportMlsFault(conversationId, {
        deviceId: this.deviceId,
        epoch,
        reason: reason.slice(0, 500),
      });
    } catch (error) {
      this.reportedFaults.delete(key);
      console.warn(`Could not report the refused commit in ${conversationId}`, error);
    }
  }

  async markDeclaredSeen(conversationId: ConversationId): Promise<void> {
    if (this.declaredSeen.has(conversationId)) return;

    await this.storage.save(declaredMarkerKey(conversationId), DECLARED_MARKER);
    this.declaredSeen.add(conversationId);
  }

  async forget(conversationId: ConversationId): Promise<void> {
    this.declaredSeen.delete(conversationId);
    await this.storage.delete(declaredMarkerKey(conversationId));
  }

  private async hasSeenDeclared(conversationId: ConversationId): Promise<boolean> {
    if (this.declaredSeen.has(conversationId)) return true;
    if (!(await this.storage.load(declaredMarkerKey(conversationId)))) return false;

    this.declaredSeen.add(conversationId);
    return true;
  }
}
