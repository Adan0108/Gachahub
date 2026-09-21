import { api } from '../../api';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
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
  GroupStateUnavailableError,
  EpochConflictError,
  MembershipMismatchError,
} from '../contract/errors';
import {
  describeMembershipMismatch,
  parseDeclaredMembership,
  type DeclaredMembership,
} from './declaredMembership';
import type {
  ConversationId,
  DeviceId,
  Epoch,
  MembershipChange,
  MembershipChangeRequest,
  PlaintextEnvelope,
  ProcessResult,
  UserId,
} from '../contract/types';

// Stored beside the group state, under a key of its own, so it survives a reload.
const DECLARED_MARKER = new Uint8Array([1]);
const declaredMarkerKey = (conversationId: ConversationId) => `${conversationId}#declared`;

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
  // Serializes process()/stageCommit() calls per conversation (client.ts:
  // "the caller ... is responsible for never calling this concurrently for
  // the same conversationId"). Only covers this browser tab - a second tab
  // open on the same conversation is a known, accepted gap (same class as
  // the one already noted for the device identity's AES key).
  private readonly locks = new Map<ConversationId, Promise<unknown>>();
  private reconcileQueue: Promise<void> = Promise.resolve();
  // Conversations in which a declared Commit has been seen (see verifyCommit).
  private readonly declaredSeen = new Set<ConversationId>();

  constructor(
    private readonly factory: GroupSessionFactory,
    private readonly deviceId: DeviceId,
    private readonly ownUserId: UserId,
    private readonly storage: GroupSessionStorage = new EncryptedIndexedDbGroupSessionStorage(),
  ) {}

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
   * Claims a key package for EVERY active device of `userId`, plus every
   * other active device of this user (this device created the group, so it
   * is already in), and commits them all into the conversation in one
   * Commit. MLS membership is per device, so adding only one device would
   * leave the rest unable to read the conversation. Throws
   * EpochConflictError if another device's commit won the race first - the
   * group is already caught up on the winner by the time this throws, so
   * the caller can decide whether to retry.
   */
  async addUserToConversation(conversationId: ConversationId, userId: UserId): Promise<Epoch> {
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

  /**
   * Finishes the membership changes (adds and removals) the server has
   * authorized for this device to carry out - see MembershipReconciler. Calls
   * are queued one after another, so the poll and a send that just hit a
   * pending removal never claim key packages for the same change twice.
   */
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
   * Lower-level primitive for addUserToConversation and any future
   * multi-add/remove case - the caller supplies already-resolved
   * KeyPackageOffers/DeviceCredentials directly.
   */
  async submitMembershipChange(
    conversationId: ConversationId,
    change: MembershipChangeRequest,
  ): Promise<Epoch> {
    return this.runExclusive(conversationId, async () => {
      const session = await this.getSession(conversationId);
      const { wireBytes, expectedEpoch, welcomes } = await session.stageCommit(change);

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
        addedDeviceIds: change.added.map((offer) => offer.credential.deviceId),
        removedDeviceIds: change.removed.map((credential) => credential.deviceId),
      });

      if (response.outcome === 'conflict') {
        await session.commitRejected();
        await this.applyIncoming(
          conversationId,
          session,
          base64ToBytes(response.handshake.payload),
          parseDeclaredMembership(response.handshake),
        );
        throw new EpochConflictError(conversationId, expectedEpoch);
      }

      await session.commitAccepted();
      await this.persistSession(conversationId, session);
      await this.markDeclaredSeen(conversationId);
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

      for (const handshake of handshakes) {
        // eslint-disable-next-line no-await-in-loop -- must apply strictly in epoch order, and each one persists before the next is attempted
        const result = await this.applyIncoming(
          conversationId,
          session,
          base64ToBytes(handshake.payload),
          parseDeclaredMembership(handshake),
        );
        if (result.kind === 'rejected') {
          // The backend already validated framing/groupId before storing
          // this handshake (mls-handshake-framing.util.ts) - a rejection
          // here means a local bug, not a bad server response.
          throw new Error(
            `Could not apply handshake at epoch ${handshake.epoch}: ${result.reason}`,
          );
        }
      }

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
   * A Welcome can be re-delivered for a conversation this device already
   * joined (e.g. the join succeeded but the consumeMlsWelcome call that
   * follows it failed - a crash, a dropped connection - leaving the
   * Welcome pending for the next call, by which point this device may have
   * advanced the group well past epoch 0). Re-joining unconditionally would
   * silently rewind/clobber that already-advanced session, so an existing
   * session for the conversation is left untouched and the stale Welcome is
   * just consumed without acting on it.
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
          if (await this.hasSession(welcome.conversationId)) {
            // Stale/re-delivered Welcome for a conversation already joined
            // - still consume it so it stops being handed back, but this
            // isn't a new join.
            await api.consumeMlsWelcome(this.deviceId, welcome.id);
            return false;
          }
          const session = await this.factory.joinFromWelcome(
            welcome.conversationId,
            base64ToBytes(welcome.payload),
          );
          this.sessions.set(welcome.conversationId, session);
          await this.persistSession(welcome.conversationId, session);
          await api.consumeMlsWelcome(this.deviceId, welcome.id);
          return true;
        });
        if (didJoin) {
          joined.push(welcome.conversationId);
        }
      } catch (error) {
        failures.push({ welcomeId: welcome.id, error });
      }
    }

    return { joined, failures };
  }

  /** Whether this device already has a session (cached or persisted) for `conversationId` - used to avoid rejoining a stale/re-delivered Welcome over an already-advanced session. */
  private async hasSession(conversationId: ConversationId): Promise<boolean> {
    if (this.sessions.has(conversationId)) {
      return true;
    }
    return (await this.storage.load(conversationId)) !== undefined;
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
      this.declaredSeen.delete(conversationId);
      await this.storage.delete(conversationId);
      await this.storage.delete(declaredMarkerKey(conversationId));
    });
  }

  /**
   * Applies one incoming wire item and saves the result - unless it is a
   * Commit that fails verification, in which case nothing is saved and the
   * in-memory session (which process() already advanced) is dropped, so the
   * next use reloads the last epoch that WAS verified. `declared` is what the
   * server recorded the Commit as doing; a Commit that arrives without it
   * cannot be checked and is refused the same way.
   */
  private async applyIncoming(
    conversationId: ConversationId,
    session: GroupSession,
    wireBytes: Uint8Array,
    declared?: DeclaredMembership,
  ): Promise<ProcessResult> {
    const result = await session.process(wireBytes);

    if (result.kind === 'commit') {
      const problem = await this.verifyCommit(conversationId, result.membershipChange, declared);

      if (problem) {
        this.sessions.delete(conversationId);
        throw new MembershipMismatchError(conversationId, problem);
      }
    }

    await this.persistSession(conversationId, session);
    return result;
  }

  /**
   * Why a Commit can't be accepted, or undefined when it can. Beyond checking
   * it against what the server recorded, this makes "declared" one-way per
   * group: once a declared Commit has been seen, a later one the server calls
   * undeclared is a fault. Without that, a server could switch verification
   * off for a group just by reporting its Commits as undeclared - and no real
   * group ever goes back, because the server refuses to extend a group that
   * predates membership tracking.
   */
  private async verifyCommit(
    conversationId: ConversationId,
    actual: MembershipChange | null,
    declared: DeclaredMembership | undefined,
  ): Promise<string | undefined> {
    if (!declared) {
      return 'it arrived without the membership the server recorded for it, so it cannot be checked';
    }

    if (!declared.membershipDeclared) {
      return (await this.hasSeenDeclared(conversationId))
        ? 'the server reported it as undeclared, although earlier commits in this group were declared'
        : undefined;
    }

    const mismatch = describeMembershipMismatch(actual, declared);
    if (mismatch) return mismatch;

    await this.markDeclaredSeen(conversationId);
    return undefined;
  }

  private async hasSeenDeclared(conversationId: ConversationId): Promise<boolean> {
    if (this.declaredSeen.has(conversationId)) return true;

    const marker = await this.storage.load(declaredMarkerKey(conversationId));
    if (!marker) return false;

    this.declaredSeen.add(conversationId);
    return true;
  }

  private async markDeclaredSeen(conversationId: ConversationId): Promise<void> {
    if (this.declaredSeen.has(conversationId)) return;

    await this.storage.save(declaredMarkerKey(conversationId), DECLARED_MARKER);
    this.declaredSeen.add(conversationId);
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
    await this.storage.save(conversationId, stateBytes);
  }

  /** Chains `task` after whatever is already pending for `conversationId`, so per-conversation operations never overlap - a settled (never-rejecting) copy is what's kept in the map so one failure doesn't wedge the chain for later calls. */
  private runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const result = previous.then(task, task);
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
