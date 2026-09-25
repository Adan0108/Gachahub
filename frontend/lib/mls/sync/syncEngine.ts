import { api } from '../../api';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import { CommitApplier, handshakeTime, type Handshake } from './commitApplier';
import { CommitVerifier } from './commitVerifier';
import { publishableGroupInfo } from './groupInfoPublishing';
import { RecoveryCooldown } from './recoveryCooldown';
import { SelfJoiner } from './selfJoiner';
import { toKeyPackageOffer, type ClaimedKeyPackage } from './keyPackageOffer';
import { GroupProblemTracker } from './groupProblems';
import { GroupRecovery } from './groupRecovery';
import { GroupSessionCache } from './groupSessionCache';
import { PendingCommitRecovery, type CommitRequest, type EventChange } from './pendingCommitRecovery';
import { WelcomeJoiner } from './welcomeJoiner';
import { readPage } from './pagedResponse';
import { HANDSHAKE_PAGE_SIZE } from './handshakeLog';
import { isDefinitiveRejection } from './submitErrors';
import type { KeyPackageSupply } from '../device/keyPackageReplenisher';
import {
  MembershipReconciler,
  type ReconcileOptions,
  type ReconcileSummary,
} from './membershipReconciler';
import {
  EncryptedIndexedDbGroupSessionStorage,
  type GroupSessionStorage,
} from '../storage/groupSessionStorage';
import {
  GroupStateUnavailableError,
  EpochConflictError,
  MembershipMismatchError,
  NoEncryptableMembersError,
} from '../contract/errors';
import { onMlsSecretsWiped } from '../storage/mlsEncryptedStore';
import { parseDeclaredMembership } from './declaredMembership';
import type { MembershipEventLog } from './membershipEventLog';
import { deriveMembershipEvents, type MembershipEvent } from './membershipEvents';
import type {
  ConversationId,
  DeviceCredential,
  DeviceId,
  Epoch,
  MembershipChangeRequest,
  PlaintextEnvelope,
  ProcessResult,
  UserId,
} from '../contract/types';

const warnEventLost = (error: unknown) => console.warn('Could not save a membership notice', error);
const warnSettleLost = (error: unknown) => console.warn('Could not settle an unfinished send or join', error);

/** Keeps one device's MLS group sessions in sync with the backend; the collaborators own each mechanism. */
export class SyncEngine {
  private readonly stopWipeListener: () => void;
  private reconcileQueue: Promise<void> = Promise.resolve();
  private readonly verifier: CommitVerifier;
  private readonly cache: GroupSessionCache;
  private readonly applier: CommitApplier;
  private readonly selfJoiner: SelfJoiner;
  private readonly pendingCommits: PendingCommitRecovery;
  private readonly welcomes: WelcomeJoiner;
  private readonly recovery: GroupRecovery;
  private readonly recoveryCooldown = new RecoveryCooldown();
  /** Groups this device cannot use, for the UI to explain instead of failing message by message. */
  readonly groupProblems = new GroupProblemTracker();

  constructor(
    private readonly factory: GroupSessionFactory,
    private readonly deviceId: DeviceId,
    private readonly ownUserId: UserId,
    storage: GroupSessionStorage = new EncryptedIndexedDbGroupSessionStorage(),
    private readonly keyPackageSupply?: KeyPackageSupply,
    membershipEvents?: MembershipEventLog,
  ) {
    this.verifier = new CommitVerifier(storage, deviceId);
    this.cache = new GroupSessionCache(factory, storage, deviceId, this.groupProblems);
    this.applier = new CommitApplier(
      this.cache,
      this.verifier,
      this.groupProblems,
      deviceId,
      membershipEvents,
    );
    this.selfJoiner = new SelfJoiner(
      {
        runExclusive: (id, task) => this.cache.runExclusive(id, task),
        hasState: async (id) => (await this.cache.savedEpoch(id)) !== undefined,
        adopt: (id, session) => this.cache.adopt(id, session),
        assertNotWiped: (id) => this.cache.assertNotWiped(id),
      },
      factory,
      storage,
      this.verifier,
      this.groupProblems,
      deviceId,
      this.recoveryCooldown,
      keyPackageSupply,
    );
    this.pendingCommits = new PendingCommitRecovery(
      this.cache,
      storage,
      factory,
      this.verifier,
      (id, session, commit) => this.applier.recordMembershipEvents(id, session, commit),
    );
    this.welcomes = new WelcomeJoiner(
      this.cache,
      factory,
      this.verifier,
      this.groupProblems,
      deviceId,
      keyPackageSupply,
    );
    this.recovery = new GroupRecovery(
      {
        runExclusive: (id, task) => this.cache.runExclusive(id, task),
        forgetLocked: (id) => this.forgetConversationLocked(id),
      },
      factory,
      storage,
      this.groupProblems,
      this.recoveryCooldown,
      this.selfJoiner,
    );
    this.stopWipeListener = onMlsSecretsWiped(() => this.dropAllCaches());
  }

  /** Stops listening for wipes and drops every cache: call when this engine is replaced. */
  dispose(): void {
    this.stopWipeListener();
    this.dropAllCaches();
  }

  /** Creates a brand-new group for a first DM or group chat - this device is the sole initial member. */
  async createGroup(conversationId: ConversationId): Promise<GroupSession> {
    return this.cache.runExclusive(conversationId, async () => {
      const session = await this.factory.create(conversationId);
      await this.cache.adopt(conversationId, session);
      this.groupProblems.clear(conversationId);
      return session;
    });
  }

  /** Seeds a group this device has just created with a single other member (the DM case). */
  async seedNewGroup(conversationId: ConversationId, userId: UserId): Promise<Epoch> {
    return this.seedNewGroupWithMembers(conversationId, [userId]);
  }

  /**
   * Seeds a group this device has just created: one Commit adds every active device of `userIds` and
   * of this user. Only for a brand-new group; later changes go through reconcileMembership. Throws
   * EpochConflictError if another device's commit won first (the group is then caught up on the winner).
   */
  async seedNewGroupWithMembers(
    conversationId: ConversationId,
    userIds: UserId[],
  ): Promise<Epoch> {
    const [theirClaims, myOtherDevices] = (await Promise.all([
      Promise.all(userIds.map((userId) => api.claimChatDeviceKeyPackages(userId))),
      api.claimChatDeviceKeyPackages(this.ownUserId, { excludeDeviceId: this.deviceId }),
    ])) as [ClaimedKeyPackage[][], ClaimedKeyPackage[]];

    const added = userIds.flatMap((userId, index) =>
      theirClaims[index]!.map((claimed) => toKeyPackageOffer(userId, claimed)),
    );
    added.push(...myOtherDevices.map((claimed) => toKeyPackageOffer(this.ownUserId, claimed)));

    // Without a Commit this device's leaf is never recorded server-side, so nothing could ever bootstrap the group.
    if (added.length === 0) {
      throw new NoEncryptableMembersError(conversationId);
    }

    return this.submitMembershipChange(conversationId, { added, removed: [] });
  }

  /** Finishes the server-authorized adds and removals (see MembershipReconciler); calls queue so none claims key packages twice. */
  reconcileMembership(options: ReconcileOptions = {}): Promise<ReconcileSummary> {
    const run = this.reconcileQueue.then(() =>
      new MembershipReconciler(this, this.deviceId).reconcile(options),
    );
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Welcomes, then self-joins, then membership work; on 'pending' one cheap probe decides which steps run. */
  async processPendingMlsWork(scope: 'pending' | 'full'): Promise<void> {
    const pending =
      scope === 'pending'
        ? ((await api.getMlsPendingSummary(this.deviceId)) as {
            welcomes: number;
            joinable: boolean;
            membershipWork: boolean;
          })
        : { welcomes: 1, joinable: true, membershipWork: true };

    if (pending.welcomes > 0) await this.processPendingWelcomes();
    if (pending.joinable) await this.joinGroupsByItself({ scope });
    if (pending.membershipWork) await this.reconcileMembership({ scope });
    await this.keyPackageSupply?.maybeReplenish();
  }

  /** Joins every group this device is entitled to by itself (see SelfJoiner). */
  joinGroupsByItself(options: { scope?: 'pending' | 'full' } = {}): Promise<ConversationId[]> {
    return this.selfJoiner.joinGroupsByItself(options);
  }

  /** Adds this device to one group from its published snapshot (see SelfJoiner). */
  joinByExternalCommit(conversationId: ConversationId): Promise<boolean> {
    return this.selfJoiner.joinByExternalCommit(conversationId);
  }

  /** One bounded self-join try for a group this device has no state for (see GroupRecovery). */
  recoverMissingGroup(conversationId: ConversationId): Promise<boolean> {
    return this.recovery.recoverMissingGroup(conversationId);
  }

  /** One bounded repair for saved state that cannot be decrypted (see GroupRecovery). */
  recoverUnreadableGroup(conversationId: ConversationId): Promise<boolean> {
    return this.recovery.recoverUnreadableGroup(conversationId);
  }

  /** How long until another recovery try is allowed for this group; 0 when one is allowed now. */
  recoveryWaitMs(conversationId: ConversationId): number {
    return this.recovery.waitMs(conversationId);
  }

  /** Joins every pending Welcome (see WelcomeJoiner). */
  processPendingWelcomes(): ReturnType<WelcomeJoiner['processPendingWelcomes']> {
    return this.welcomes.processPendingWelcomes();
  }

  /** Commits a membership change from already-resolved KeyPackageOffers/DeviceCredentials. */
  async submitMembershipChange(
    conversationId: ConversationId,
    change: MembershipChangeRequest,
  ): Promise<Epoch> {
    return this.cache.runExclusive(conversationId, async () => {
      const session = await this.openSession(conversationId);
      const epochBefore = await session.serialize();
      const { wireBytes, expectedEpoch, welcome, groupInfo } = await session.stageCommit(change);

      const request: CommitRequest = {
        deviceId: this.deviceId,
        epoch: expectedEpoch,
        payload: bytesToBase64(wireBytes),
        welcome: welcome && {
          recipientDeviceIds: welcome.deviceIds,
          payload: bytesToBase64(welcome.welcomeBytes),
        },
        // Published so another device can join by itself later, with no member online.
        groupInfo: publishableGroupInfo(groupInfo),
        // The server checks this against the authorized roster, every other member against the Commit.
        addedDeviceIds: change.added.map((offer) => offer.credential.deviceId),
        removedDeviceIds: change.removed.map((credential) => credential.deviceId),
      };

      const eventChange: EventChange = {
        added: change.added.map((offer) => offer.credential),
        removed: change.removed,
      };

      // Merge and save the post-Commit state BEFORE submitting: MLS cannot apply a device's own Commit later.
      let response: Awaited<ReturnType<typeof api.submitMlsHandshake>>;
      try {
        await session.commitAccepted();
        await this.pendingCommits.save(conversationId, request, await session.serialize(), eventChange);
        response = await api.submitMlsHandshake(conversationId, request);
      } catch (error) {
        // The merged copy is unconfirmed; disk still holds the last epoch the server is known to have.
        this.cache.drop(conversationId);
        // A definitive refusal will never be accepted, so nothing is left to settle later.
        if (isDefinitiveRejection(error)) {
          await this.pendingCommits.discard(conversationId).catch(warnSettleLost);
        }
        throw error;
      }

      if (response.outcome === 'conflict') {
        // The merged copy is the rejected Commit's: it must not survive in memory whatever fails below.
        this.cache.drop(conversationId);
        await this.pendingCommits.discard(conversationId);
        const reloaded = await this.factory.restore(conversationId, epochBefore);
        this.cache.set(conversationId, reloaded);
        await this.applier.applyBatch(conversationId, reloaded, [response.handshake]);
        throw new EpochConflictError(conversationId, expectedEpoch);
      }

      // Declared-seen first, the pending record last, so a failure in between is settled on the next open.
      await this.verifier.markDeclaredSeen(conversationId);
      await this.cache.persist(conversationId, session);
      await this.pendingCommits.finishAccepted(
        conversationId,
        session,
        eventChange,
        handshakeTime(response.handshake),
      );
      return session.currentEpoch();
    });
  }

  /** Fetches and applies every commit since this session's current epoch, in order. */
  async syncCommits(conversationId: ConversationId): Promise<Epoch> {
    return this.cache.runExclusive(conversationId, async () => {
      const session = await this.openSession(conversationId);
      let sinceEpoch = await session.currentEpoch();

      // A capped response says hasMore: keep going while each page moves the group forward.
      for (;;) {
        const page = readPage<Handshake>(
          // eslint-disable-next-line no-await-in-loop -- each page starts from the epoch the last one reached
          await api.getMlsHandshakesSince(conversationId, sinceEpoch),
          'handshakes',
          HANDSHAKE_PAGE_SIZE,
        );
        // eslint-disable-next-line no-await-in-loop -- pages must apply in order
        await this.applier.applyBatch(conversationId, session, page.items);
        // eslint-disable-next-line no-await-in-loop -- read after the page was applied
        const reached = await session.currentEpoch();
        if (!page.hasMore || reached === sinceEpoch) break;
        sinceEpoch = reached;
      }

      // Caught up with every Commit the server has, so an earlier refusal no longer stands.
      this.groupProblems.clear(conversationId);
      return session.currentEpoch();
    });
  }

  /** Applies one live wire item outside catch-up and saves at once: replaying a consumed generation is unsafe. */
  async processIncoming(
    conversationId: ConversationId,
    wireBytes: Uint8Array,
  ): Promise<ProcessResult> {
    return this.cache.runExclusive(conversationId, async () => {
      // Reading at the current epoch does not need a pending Commit settled, so an unreachable server must not block it.
      const session = await this.openSession(conversationId, 'best-effort');
      return this.applier.applyIncoming(conversationId, session, wireBytes);
    });
  }

  /** Encrypts for the current epoch and saves the advanced ratchet at once; returns the epoch it went out under. */
  async encryptMessage(
    conversationId: ConversationId,
    envelope: PlaintextEnvelope,
  ): Promise<{ wireBytes: Uint8Array; epoch: Epoch }> {
    return this.cache.runExclusive(conversationId, async () => {
      const session = await this.openSession(conversationId);
      const wireBytes = await session.encrypt(envelope);
      await this.cache.persist(conversationId, session);
      return { wireBytes, epoch: await session.currentEpoch() };
    });
  }

  /** The current local epoch; throws GroupStateUnavailableError without a session. Locked so a cache miss cannot race. */
  async getCurrentEpoch(conversationId: ConversationId): Promise<Epoch> {
    return this.cache.runExclusive(conversationId, async () => {
      const session = await this.openSession(conversationId);
      return session.currentEpoch();
    });
  }

  /** Every device in this device's local (commit-verified) copy of the group; undefined when there is no usable local group. */
  async listLeaves(conversationId: ConversationId): Promise<DeviceCredential[] | undefined> {
    return this.cache.runExclusive(conversationId, async () => {
      try {
        return await (await this.cache.get(conversationId)).listLeaves();
      } catch {
        return undefined;
      }
    });
  }

  /** Whether `wireBytes` was framed under the current epoch; local only and never throws. */
  async isAtCurrentEpoch(conversationId: ConversationId, wireBytes: Uint8Array): Promise<boolean> {
    return this.cache.runExclusive(conversationId, async () => {
      let session: GroupSession;
      try {
        session = await this.cache.get(conversationId);
      } catch {
        return false;
      }
      const [current, incoming] = await Promise.all([
        session.currentEpoch(),
        session.peekEpoch(wireBytes),
      ]);
      return incoming !== undefined && incoming === current;
    });
  }

  /** Drops a conversation's cached and persisted session, waiting behind whatever is in flight for it. */
  async forgetConversation(conversationId: ConversationId): Promise<void> {
    return this.cache.runExclusive(conversationId, async () => {
      await this.forgetConversationLocked(conversationId);
      this.groupProblems.clear(conversationId);
    });
  }

  private async forgetConversationLocked(conversationId: ConversationId): Promise<void> {
    await this.cache.forget(conversationId);
    await this.pendingCommits.discard(conversationId);
    await this.selfJoiner.discardPendingJoin(conversationId);
    await this.verifier.forget(conversationId);
  }

  /** After a wipe nothing cached may be saved back or trusted. */
  private dropAllCaches(): void {
    this.cache.dropAll();
    this.groupProblems.clearAll();
    this.recoveryCooldown.clear();
    this.pendingCommits.forgetKnownAbsent();
  }

  /**
   * The cached session, after settling what a crash may have left half done: a submitted Commit, or a self-join with no saved group.
   * Writing needs the Commit settled; a read may go on without it when the server cannot be reached.
   */
  private async openSession(
    conversationId: ConversationId,
    settle: 'required' | 'best-effort' = 'required',
  ): Promise<GroupSession> {
    if (settle === 'required') await this.pendingCommits.resolve(conversationId);
    else await this.pendingCommits.resolve(conversationId).catch(warnSettleLost);

    try {
      return await this.cache.get(conversationId);
    } catch (error) {
      // A failed join resolution must never hide that there is no group: recovery keys off this error.
      if (
        error instanceof GroupStateUnavailableError &&
        (await this.tryResolvePendingJoin(conversationId))
      ) {
        return this.cache.peek(conversationId)!;
      }
      throw error;
    }
  }

  private async tryResolvePendingJoin(conversationId: ConversationId): Promise<boolean> {
    try {
      return await this.selfJoiner.resolvePendingJoin(conversationId);
    } catch (error) {
      warnSettleLost(error);
      return false;
    }
  }
}
