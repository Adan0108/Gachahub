import { api } from '../../api';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import { CommitVerifier } from './commitVerifier';
import { withCrossTabLock } from './crossTabLock';
import { toKeyPackageOffer, type ClaimedKeyPackage } from './keyPackageOffer';
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
  CredentialMismatchError,
  GroupStateUnavailableError,
  EpochConflictError,
  MembershipMismatchError,
  StaleWelcomeError,
} from '../contract/errors';
import { parseDeclaredMembership } from './declaredMembership';
import type {
  ConversationId,
  DeviceId,
  Epoch,
  MembershipChangeRequest,
  PlaintextEnvelope,
  ProcessResult,
  UserId,
} from '../contract/types';

// Stored beside the group state, under a key of its own.
const versionKey = (conversationId: ConversationId) => `${conversationId}#version`;

/**
 * Orchestrates one device's MLS group sessions against the real backend
 * (chat-devices claim endpoint, mls-handshakes submit/fetch/welcomes) - the
 * "SyncEngine" mentioned in client.ts as sitting on top of GroupSession/
 * GroupSessionFactory. Pure app logic, no per-library variation - depends
 * only on the GroupSessionFactory contract, not any concrete adapter.
 *
 * Does not touch the chat UI or decide which conversations exist - that's
 * stage 8. This only knows how to keep a conversation's group session in
 * sync with the backend once told which conversationId to work with.
 */
export class SyncEngine {
  private readonly sessions = new Map<ConversationId, GroupSession>();
  // The version stamp of the saved session each cached one was loaded or last saved at, so another tab's write is noticed.
  private readonly versions = new Map<ConversationId, string | undefined>();
  // Serializes process()/stageCommit() calls per conversation (client.ts:
  // "the caller ... is responsible for never calling this concurrently for
  // the same conversationId"). Only covers this browser tab - a second tab
  // open on the same conversation is a known, accepted gap (same class as
  // the one already noted for the device identity's AES key).
  private readonly locks = new Map<ConversationId, Promise<unknown>>();
  private reconcileQueue: Promise<void> = Promise.resolve();
  private readonly verifier: CommitVerifier;

  constructor(
    private readonly factory: GroupSessionFactory,
    private readonly deviceId: DeviceId,
    private readonly ownUserId: UserId,
    private readonly storage: GroupSessionStorage = new EncryptedIndexedDbGroupSessionStorage(),
  ) {
    this.verifier = new CommitVerifier(storage, deviceId);
  }

  /** Creates a brand-new group for a first DM or group chat - this device is the sole initial member. */
  async createGroup(conversationId: ConversationId): Promise<GroupSession> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.factory.create(conversationId);
      this.sessions.set(conversationId, session);
      await this.persistSession(conversationId, session);
      return session;
    });
  }

  /**
   * Seeds a group this device has JUST created: claims a key package for EVERY
   * active device of `userId`, plus every other active device of this user (this
   * device created the group, so it is already in), and commits them all into
   * the conversation in one Commit. Only for a brand-new group - on a group that
   * already exists this user's other devices are members, so the server would
   * refuse it and the packages would be wasted. Changes to a live group (a new
   * member, a new device, a removal) go through reconcileMembership.
   * MLS membership is per device, so adding only one device would
   * leave the rest unable to read the conversation. Throws
   * EpochConflictError if another device's commit won the race first - the
   * group is already caught up on the winner by the time this throws, so
   * the caller can decide whether to retry.
   */
  async seedNewGroup(conversationId: ConversationId, userId: UserId): Promise<Epoch> {
    const [theirDevices, myOtherDevices] = (await Promise.all([
      api.claimChatDeviceKeyPackages(userId),
      api.claimChatDeviceKeyPackages(this.ownUserId, { excludeDeviceId: this.deviceId }),
    ])) as [ClaimedKeyPackage[], ClaimedKeyPackage[]];

    return this.submitMembershipChange(conversationId, {
      added: [
        ...theirDevices.map((claimed) => toKeyPackageOffer(userId, claimed)),
        ...myOtherDevices.map((claimed) => toKeyPackageOffer(this.ownUserId, claimed)),
      ],
      removed: [],
    });
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

  /**
   * Everything the regular poll does: welcomes first (they make this device able to act), then joins,
   * then membership work. On the frequent 'pending' pass one cheap probe decides which steps run at all,
   * so an idle tab costs one request per poll instead of three.
   */
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
  }

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
    return joined;
  }

  /**
   * Adds this device to a group from its published snapshot. The snapshot comes from a member, so the group
   * inside it is checked against the server's roster BEFORE the join is sent, and nothing is saved unless
   * the server accepts. Returns false when there is nothing to do, or another change to the group won first
   * (the next attempt starts from the new snapshot).
   */
  async joinByExternalCommit(conversationId: ConversationId): Promise<boolean> {
    return this.runExclusive(conversationId, async () => {
      if ((await this.savedEpoch(conversationId)) !== undefined) return false;

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

      const response = await api.submitMlsExternalJoin(conversationId, {
        deviceId: this.deviceId,
        epoch: snapshot.epoch,
        payload: bytesToBase64(joined.commitBytes),
        groupInfo: bytesToBase64(joined.groupInfoBytes),
      });
      if (response.outcome !== 'accepted') return false;

      this.sessions.set(conversationId, joined.session);
      await this.persistSession(conversationId, joined.session);
      await this.verifier.markDeclaredSeen(conversationId);
      return true;
    });
  }

  /**
   * Lower-level primitive for seedNewGroup and the reconciler's
   * multi-add/remove Commits - the caller supplies already-resolved
   * KeyPackageOffers/DeviceCredentials directly.
   */
  async submitMembershipChange(
    conversationId: ConversationId,
    change: MembershipChangeRequest,
  ): Promise<Epoch> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      const { wireBytes, expectedEpoch, welcomes, groupInfo } = await session.stageCommit(change);

      const response = await api.submitMlsHandshake(conversationId, {
        deviceId: this.deviceId,
        epoch: expectedEpoch,
        payload: bytesToBase64(wireBytes),
        welcomes: welcomes.map((welcome) => ({
          recipientDeviceId: welcome.deviceId,
          payload: bytesToBase64(welcome.welcomeBytes),
        })),
        // What this Commit does to the group. The server checks it against the
        // authorized roster; every other member checks it against the Commit.
        // Published so another device can join by itself later, with no member online.
        groupInfo: bytesToBase64(groupInfo),
        addedDeviceIds: change.added.map((offer) => offer.credential.deviceId),
        removedDeviceIds: change.removed.map((credential) => credential.deviceId),
      });

      if (response.outcome === 'conflict') {
        await session.commitRejected();
        await this.applyBatch(conversationId, session, [response.handshake]);
        throw new EpochConflictError(conversationId, expectedEpoch);
      }

      await session.commitAccepted();
      await this.persistSession(conversationId, session);
      await this.verifier.markDeclaredSeen(conversationId);
      return session.currentEpoch();
    });
  }

  /**
   * Fetches and applies every commit since this session's current epoch, in
   * order - catch-up after being offline (client.ts's GroupSession.process
   * ordering requirement).
   */
  async syncCommits(conversationId: ConversationId): Promise<Epoch> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      const sinceEpoch = await session.currentEpoch();
      const handshakes = await api.getMlsHandshakesSince(conversationId, sinceEpoch);

      await this.applyBatch(conversationId, session, handshakes);

      return session.currentEpoch();
    });
  }

  /**
   * Applies one incoming wire item outside the catch-up flow - in practice
   * an application message delivered live, since commits normally arrive
   * via syncCommits. Persists immediately: unlike reapplying a Commit
   * (a deterministic re-derivation from the prior epoch, safe to repeat),
   * replaying an already-consumed message generation is not safely
   * repeatable, so a crash between processing and persisting must not
   * force a retry.
   */
  async processIncoming(
    conversationId: ConversationId,
    wireBytes: Uint8Array,
  ): Promise<ProcessResult> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      return this.applyIncoming(conversationId, session, wireBytes);
    });
  }

  /**
   * Encrypts a plaintext envelope for the current epoch and persists the
   * advanced ratchet state immediately (key reuse on a crash-before-persist
   * would be a real forward-secrecy violation, not just a lost message).
   * Returns the epoch it was encrypted under, read from this same locked
   * session right after encrypt() rather than via a separate
   * getCurrentEpoch() call afterward - the lock releases between two
   * separate calls, so a commit processed in that gap could advance the
   * epoch before the second call reads it, mislabeling which epoch this
   * message actually went out under.
   */
  async encryptMessage(
    conversationId: ConversationId,
    envelope: PlaintextEnvelope,
  ): Promise<{ wireBytes: Uint8Array; epoch: Epoch }> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      const wireBytes = await session.encrypt(envelope);
      await this.persistSession(conversationId, session);
      return { wireBytes, epoch: await session.currentEpoch() };
    });
  }

  /**
   * Fetches this device's pending Welcomes, joins each one, and consumes it
   * on success. A failed Welcome (malformed, or addressed to a key package
   * this device no longer recognizes) is skipped rather than aborting the
   * whole batch, and is left unconsumed - it will be retried next call
   * rather than silently discarded. Not device-conversation-scoped like the
   * other methods, since a device doesn't know which conversationIds it's
   * being welcomed into until it asks.
   *
   * A device that already has a session may still need the Welcome: after being
   * removed and re-added, it is the only way back in. So it is joined first, and
   * replaces the old session only if it is a later epoch. One at or before the
   * current epoch, or one this device can no longer open (its key package was
   * spent by an earlier join), is stale and is consumed without joining.
   */
  async processPendingWelcomes(): Promise<{
    joined: ConversationId[];
    failures: Array<{ welcomeId: string; error: unknown }>;
  }> {
    const pending = await api.getMlsPendingWelcomes(this.deviceId);
    const joined: ConversationId[] = [];
    const failures: Array<{ welcomeId: string; error: unknown }> = [];

    for (const welcome of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop -- each Welcome is joined and consumed independently; no benefit to parallelizing sequential backend calls
        const didJoin = await this.runExclusive(welcome.conversationId, async () => {
          const existingEpoch = await this.savedEpoch(welcome.conversationId);
          let session: GroupSession;

          try {
            session = await this.factory.joinFromWelcome(
              welcome.conversationId,
              base64ToBytes(welcome.payload),
              {
                verify: async (joined) => {
                  if (
                    existingEpoch !== undefined &&
                    (await joined.currentEpoch()) <= existingEpoch
                  ) {
                    throw new StaleWelcomeError();
                  }
                  await this.verifier.assertTreeMatchesRoster(welcome.conversationId, joined);
                },
              },
            );
          } catch (error) {
            const isStale =
              error instanceof StaleWelcomeError ||
              (existingEpoch !== undefined && error instanceof CredentialMismatchError);
            if (!isStale) throw error;

            // Not a newer group: consume it so it stops being handed back.
            await api.consumeMlsWelcome(this.deviceId, welcome.id);
            return false;
          }

          this.sessions.set(welcome.conversationId, session);
          await this.persistSession(welcome.conversationId, session);
          await api.consumeMlsWelcome(this.deviceId, welcome.id);
          return true;
        });
        if (didJoin) {
          joined.push(welcome.conversationId);
        }
      } catch (error) {
        // A refused group's key package is spent, so retrying this Welcome could never succeed.
        if (error instanceof MembershipMismatchError) {
          try {
            // eslint-disable-next-line no-await-in-loop -- best effort, one Welcome at a time
            await api.consumeMlsWelcome(this.deviceId, welcome.id);
          } catch {
            // it stays pending and is refused again next poll
          }
        }
        failures.push({ welcomeId: welcome.id, error });
      }
    }

    return { joined, failures };
  }

  /** The epoch of the saved session for `conversationId`, or undefined when there is none (or it can't be restored, so a Welcome should replace it). */
  private async savedEpoch(conversationId: ConversationId): Promise<Epoch | undefined> {
    try {
      return await (await this.getSession(conversationId)).currentEpoch();
    } catch (error) {
      if (error instanceof GroupStateUnavailableError) return undefined;
      throw error;
    }
  }

  /**
   * The conversation's current local epoch - throws
   * GroupStateUnavailableError if this device has no session for it.
   * Routed through runExclusive even though it's a pure read: getSession's
   * cache-miss path awaits storage.load + factory.restore before caching
   * the result, and an unlocked caller landing in that gap alongside a
   * locked operation's own first getSession call would each independently
   * restore and cache their own GroupSession instance from the same
   * bytes - whichever's persistSession runs last then silently overwrites
   * the other's advanced state in storage with a stale snapshot.
   */
  async getCurrentEpoch(conversationId: ConversationId): Promise<Epoch> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      return session.currentEpoch();
    });
  }

  /**
   * Whether `wireBytes` was framed under this session's current epoch -
   * purely local (no network), safe to call before deciding if
   * syncCommits is actually needed before processIncoming. False for
   * anything that doesn't parse as this conversation's current epoch,
   * including a message from a later epoch (a real missed commit), an
   * unrecognizable payload, or this device not even having a local session
   * yet (e.g. its Welcome hasn't been processed yet, at the very start of
   * a conversation) - either way the caller should sync/process normally
   * and get the real outcome there rather than assume anything. Never
   * throws, by design: a "should I skip the network call" check has no
   * business surfacing GroupStateUnavailableError itself.
   */
  async isAtCurrentEpoch(conversationId: ConversationId, wireBytes: Uint8Array): Promise<boolean> {
    // Same reasoning as getCurrentEpoch above - getSession's cache-miss
    // path isn't safe to race against a locked operation's own.
    return this.runExclusive(conversationId, async () => {
      let session: GroupSession;
      try {
        session = await this.getSession(conversationId);
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

  /**
   * Drops a conversation's cached and persisted session - e.g. after
   * leaving or deleting it. Routed through runExclusive so it waits its
   * turn behind whatever's already in flight for this conversationId
   * instead of clearing state out from under it - deleting the lock map
   * entry directly used to let a call arriving right after this one start
   * a brand-new chain from scratch, running concurrently with whatever
   * this call's own task was still doing instead of waiting for it.
   * Deliberately does NOT also delete the `locks` map entry itself once
   * done: a later runExclusive call for this same conversationId may
   * already be queued behind this one by the time this task runs, and
   * removing the entry here could delete that later call's own bookkeeping
   * instead of this one's. `locks` growing by one entry per
   * conversationId ever touched is an accepted, purely cosmetic trade for
   * not risking that.
   */
  async forgetConversation(conversationId: ConversationId): Promise<void> {
    return this.runExclusive(conversationId, async () => {
      this.sessions.delete(conversationId);
      this.versions.delete(conversationId);
      await this.storage.delete(conversationId);
      await this.storage.delete(versionKey(conversationId));
      await this.verifier.forget(conversationId);
    });
  }

  /**
   * Applies handshake rows from the server in order, checks them, and saves once.
   * A Commit or tree that fails a check saves nothing and drops the in-memory
   * session, so the next use reloads the last epoch that was verified.
   */
  private async applyBatch(
    conversationId: ConversationId,
    session: GroupSession,
    handshakes: Array<{ epoch: Epoch; payload: string; membershipDeclared?: boolean }>,
  ): Promise<void> {
    if (handshakes.length === 0) return;

    try {
      for (const handshake of handshakes) {
        // eslint-disable-next-line no-await-in-loop -- must apply strictly in epoch order
        await this.applyHandshake(conversationId, session, handshake);
      }

      // Commits from before membership was tracked have no roster to check against.
      if (handshakes.some((handshake) => handshake.membershipDeclared)) {
        await this.verifier.assertTreeMatchesRoster(conversationId, session);
      }
    } catch (error) {
      if (error instanceof MembershipMismatchError) this.sessions.delete(conversationId);
      throw error;
    }

    await this.persistSession(conversationId, session);
  }

  private async applyHandshake(
    conversationId: ConversationId,
    session: GroupSession,
    handshake: { epoch: Epoch; payload: string },
  ): Promise<void> {
    const result = await session.process(base64ToBytes(handshake.payload));

    if (result.kind === 'rejected') {
      // The backend already validated framing before storing this Commit, so this is a local bug.
      throw new Error(`Could not apply handshake at epoch ${handshake.epoch}: ${result.reason}`);
    }
    if (result.kind !== 'commit') return;

    const problem = await this.verifier.checkCommit(
      conversationId,
      result.membershipChange,
      parseDeclaredMembership(handshake),
    );
    if (problem) {
      this.verifier.reportFault(conversationId, handshake.epoch, problem);
      throw new MembershipMismatchError(conversationId, problem);
    }
  }

  /** Applies a live wire item and saves it at once: replaying a consumed message generation isn't safe. */
  private async applyIncoming(
    conversationId: ConversationId,
    session: GroupSession,
    wireBytes: Uint8Array,
  ): Promise<ProcessResult> {
    const result = await session.process(wireBytes);

    if (result.kind === 'commit') {
      // A Commit outside catch-up has no declaration to check it against.
      this.sessions.delete(conversationId);
      const problem = await this.verifier.checkCommit(
        conversationId,
        result.membershipChange,
        undefined,
      );
      throw new MembershipMismatchError(conversationId, problem ?? 'it cannot be checked');
    }

    await this.persistSession(conversationId, session);
    return result;
  }

  private async getSession(conversationId: ConversationId): Promise<GroupSession> {
    const cached = this.sessions.get(conversationId);
    if (cached) {
      return cached;
    }

    const stateBytes = await this.storage.load(conversationId);
    if (!stateBytes) {
      throw new GroupStateUnavailableError(conversationId);
    }

    let session: GroupSession;
    try {
      session = await this.factory.restore(conversationId, stateBytes);
    } catch (error) {
      throw new GroupStateUnavailableError(conversationId, error);
    }
    this.sessions.set(conversationId, session);
    return session;
  }

  private async persistSession(
    conversationId: ConversationId,
    session: GroupSession,
  ): Promise<void> {
    const stateBytes = await session.serialize();
    // Stamp first: if a crash lands between the two writes, other tabs reload the older state, which is still consistent.
    const stamp = crypto.randomUUID();
    await this.storage.save(versionKey(conversationId), new TextEncoder().encode(stamp));
    await this.storage.save(conversationId, stateBytes);
    this.versions.set(conversationId, stamp);
  }

  /** Drops the cached session when the saved one was written by another tab since it was loaded. */
  private async dropCachedSessionIfStale(conversationId: ConversationId): Promise<void> {
    const saved = await this.storage.load(versionKey(conversationId));
    const stamp = saved ? new TextDecoder().decode(saved) : undefined;

    if (this.versions.get(conversationId) !== stamp) {
      this.sessions.delete(conversationId);
    }
    this.versions.set(conversationId, stamp);
  }

  /**
   * Runs `task` alone for this device and conversation - across tabs too, via a
   * Web Lock - on a session that is as new as the saved one: another tab may
   * have advanced it. The in-tab chain keeps calls in order and a failure from
   * wedging later ones.
   */
  private runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T> {
    const locked = async () =>
      withCrossTabLock(`mls:${this.deviceId}:${conversationId}`, async () => {
        await this.dropCachedSessionIfStale(conversationId);
        return task();
      });

    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const result = previous.then(locked, locked);
    this.locks.set(
      conversationId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
