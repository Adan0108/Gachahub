import { api } from '../../api';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import type { KeyPackageSupply } from '../device/keyPackageReplenisher';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import type { ConversationId, DeviceId, Epoch } from '../contract/types';
import type { CommitVerifier } from './commitVerifier';
import type { GroupProblemTracker } from './groupProblems';
import { publishableGroupInfo } from './groupInfoPublishing';
import type { RecoveryCooldown } from './recoveryCooldown';
import { serverLogHolds } from './handshakeLog';
import { isDefinitiveRejection } from './submitErrors';
import { UnreadableRecordError } from '../storage/mlsEncryptedStore';

// A self-join saved before the server answered, so a crash between the two loses nothing.
const pendingJoinKey = (conversationId: ConversationId) => `${conversationId}#pending-join`;
// The exact request that was submitted for it, so recovering can resubmit those same bytes and let the
// server's own duplicate-vs-conflict check (identical to any Commit resubmission) say whether it won.
const pendingJoinRequestKey = (conversationId: ConversationId) =>
  `${conversationId}#pending-join-request`;

interface PendingJoinRequest {
  deviceId: DeviceId;
  epoch: Epoch;
  payload: string;
  groupInfo: string | undefined;
}

/** The slice of SyncEngine the self-joiner drives - kept narrow so it can be tested on its own. */
export interface SelfJoinHost {
  runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T>;
  /** Whether a usable saved group exists; call inside runExclusive. Throws when saved state cannot be read. */
  hasState(conversationId: ConversationId): Promise<boolean>;
  /** Persists then caches a session this device just joined. */
  adopt(conversationId: ConversationId, session: GroupSession): Promise<void>;
  /** Throws when local MLS data was wiped since the current task started. */
  assertNotWiped(conversationId: ConversationId): void;
}

/** Joins groups without a Welcome, from a member's published snapshot (external commit). */
export class SelfJoiner {
  constructor(
    private readonly host: SelfJoinHost,
    private readonly factory: GroupSessionFactory,
    private readonly storage: GroupSessionStorage,
    private readonly verifier: CommitVerifier,
    private readonly groupProblems: GroupProblemTracker,
    private readonly deviceId: DeviceId,
    private readonly cooldown: RecoveryCooldown,
    private readonly keyPackageSupply?: KeyPackageSupply,
  ) {}

  /**
   * Joins every group this device is entitled to be in but is not part of yet, by itself, with no member
   * online (see joinByExternalCommit). One that fails is left for the next time.
   */
  async joinGroupsByItself(
    options: { scope?: 'pending' | 'full' } = {},
  ): Promise<ConversationId[]> {
    const { conversationIds } = (await api.getMlsJoinableConversations(this.deviceId, options)) as {
      conversationIds: ConversationId[];
    };

    const joined: ConversationId[] = [];
    for (const conversationId of conversationIds) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one group at a time: each join advances that group's epoch
        if (await this.joinByExternalCommit(conversationId)) joined.push(conversationId);
      } catch (error) {
        console.warn(`Could not join ${conversationId} by itself`, error);
      }
    }
    if (joined.length > 0) await this.keyPackageSupply?.maybeReplenish({ force: true });
    return joined;
  }

  /**
   * Adds this device to a group from its published snapshot. The snapshot comes from a member, so the group
   * inside it is checked against the server's roster BEFORE the join is sent, and nothing is saved unless
   * the server accepts. Also finishes a join a crash left pending. Returns false when there is nothing to do,
   * or another change to the group won first (the next attempt starts from the new snapshot).
   */
  async joinByExternalCommit(conversationId: ConversationId): Promise<boolean> {
    return this.host.runExclusive(conversationId, async () => {
      if (await this.host.hasState(conversationId)) return false;
      if (await this.resolvePendingJoin(conversationId)) return true;

      const snapshot = (await api.getMlsGroupInfo(conversationId, this.deviceId)) as {
        epoch: Epoch;
        groupInfo: string;
      };
      const joined = await this.factory.joinExternally(
        conversationId,
        base64ToBytes(snapshot.groupInfo),
      );
      await this.verifier.assertTreeMatchesRoster(conversationId, joined.session, {
        epoch: snapshot.epoch,
        excludeDeviceId: this.deviceId,
      });

      const request: PendingJoinRequest = {
        deviceId: this.deviceId,
        epoch: snapshot.epoch,
        payload: bytesToBase64(joined.commitBytes),
        // Too big to publish: this group pauses self-join until it shrinks, the join itself still goes through.
        groupInfo: publishableGroupInfo(joined.groupInfoBytes),
      };
      // Saved BEFORE submitting: if this tab dies right after the server accepts, the join is recoverable
      // by resubmitting these exact bytes (see resolvePendingJoin).
      const pendingState = await joined.session.serialize();
      this.host.assertNotWiped(conversationId);
      await this.storage.save(pendingJoinKey(conversationId), pendingState);
      await this.storage.save(
        pendingJoinRequestKey(conversationId),
        new TextEncoder().encode(JSON.stringify(request)),
      );

      const response = await api.submitMlsExternalJoin(conversationId, request);
      if (response.outcome !== 'accepted') {
        await this.discardPendingJoin(conversationId);
        return false;
      }

      await this.adopt(conversationId, joined.session);
      return true;
    });
  }

  /**
   * Finishes or discards a self-join saved before its submit was answered, by resubmitting the EXACT bytes
   * that were sent - not by checking whether this device merely appears as a leaf, which membership work
   * adding the same device through an ordinary Add at the same epoch would satisfy just as well, adopting
   * the wrong (and different) group state. The server's own duplicate-vs-conflict check, identical to the
   * one every ordinary Commit resubmission already relies on, is what actually tells the two apart:
   * `duplicate`/`accepted` means this device's own join won, anything else means a different change did.
   */
  async resolvePendingJoin(conversationId: ConversationId): Promise<boolean> {
    // An unreadable record is as good as a missing one: it is discarded below.
    const [pendingBytes, requestBytes] = await Promise.all([
      this.loadOrUnreadable(pendingJoinKey(conversationId)),
      this.loadOrUnreadable(pendingJoinRequestKey(conversationId)),
    ]);
    if (!pendingBytes || !requestBytes) {
      await this.discardPendingJoin(conversationId);
      return false;
    }

    let session: GroupSession;
    let request: PendingJoinRequest;
    try {
      session = await this.factory.restore(conversationId, pendingBytes);
      request = JSON.parse(new TextDecoder().decode(requestBytes)) as PendingJoinRequest;
    } catch {
      await this.discardPendingJoin(conversationId);
      return false;
    }

    if (!(await this.serverHasJoin(conversationId, request))) {
      await this.discardPendingJoin(conversationId);
      return false;
    }

    await this.adopt(conversationId, session);
    return true;
  }

  /** Resubmitting the same bytes gets the server's answer; if that fails, its own log tells (a definitive refusal means no). */
  private async serverHasJoin(
    conversationId: ConversationId,
    request: PendingJoinRequest,
  ): Promise<boolean> {
    try {
      const response = await api.submitMlsExternalJoin(conversationId, request);
      return response.outcome === 'accepted' || response.outcome === 'duplicate';
    } catch (error) {
      if (isDefinitiveRejection(error)) return false;
      return serverLogHolds(conversationId, request);
    }
  }

  private loadOrUnreadable(key: string): Promise<Uint8Array | undefined> {
    return this.storage.load(key).catch((error: unknown) => {
      if (error instanceof UnreadableRecordError) return undefined;
      throw error;
    });
  }

  /**
   * One bounded self-join try for a group this device has no state for (never one that was refused or is
   * unreadable: those stay as they are). True when the group is usable afterwards; otherwise the group is
   * flagged as a problem until a Welcome or a later self-join fixes it.
   */
  async recoverMissingGroup(
    conversationId: ConversationId,
    options: { replacingUnreadable?: boolean } = {},
  ): Promise<boolean> {
    const kind = this.groupProblems.get(conversationId)?.kind;
    if (kind === 'refused-commit') return false;
    // The caller has just discarded the unreadable copy: the flag stays up until the rejoin works.
    if (kind === 'state-unreadable' && !options.replacingUnreadable) return false;

    if (!this.cooldown.tryStart(conversationId)) return false;

    try {
      await this.joinByExternalCommit(conversationId);
    } catch (error) {
      console.warn(`Could not rejoin ${conversationId}`, error);
    }
    if (await this.hasUsableState(conversationId)) return true;

    // An unreadable state is already flagged more precisely by getSession; a discarded one is now just missing.
    if (options.replacingUnreadable || !this.groupProblems.get(conversationId)) {
      this.groupProblems.mark(conversationId, 'state-unavailable');
    }
    return false;
  }

  async discardPendingJoin(conversationId: ConversationId): Promise<void> {
    await this.storage.delete(pendingJoinKey(conversationId));
    await this.storage.delete(pendingJoinRequestKey(conversationId));
  }

  private async adopt(conversationId: ConversationId, session: GroupSession): Promise<void> {
    await this.host.adopt(conversationId, session);
    await this.verifier.markDeclaredSeen(conversationId);
    await this.discardPendingJoin(conversationId);
    this.groupProblems.clear(conversationId);
  }

  private async hasUsableState(conversationId: ConversationId): Promise<boolean> {
    try {
      return await this.host.runExclusive(conversationId, () => this.host.hasState(conversationId));
    } catch {
      return false;
    }
  }
}
