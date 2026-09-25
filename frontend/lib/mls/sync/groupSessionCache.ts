import type { GroupSession, GroupSessionFactory } from '../contract/client';
import { GroupStateCorruptedError, GroupStateUnavailableError } from '../contract/errors';
import type { ConversationId, DeviceId, Epoch } from '../contract/types';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import {
  assertNotWiped as assertGenerationCurrent,
  currentWipeGeneration,
  UnreadableRecordError,
} from '../storage/mlsEncryptedStore';
import { withCrossTabLock } from './crossTabLock';
import type { GroupProblemTracker } from './groupProblems';

const versionKey = (conversationId: ConversationId) => `${conversationId}#version`;

/** The in-memory group sessions of one device, kept in step with saved state and other tabs. */
export class GroupSessionCache {
  private readonly sessions = new Map<ConversationId, GroupSession>();
  // The stamp each cached session was loaded or saved at, so another tab's write is noticed.
  private readonly versions = new Map<ConversationId, string | undefined>();
  private readonly locks = new Map<ConversationId, Promise<unknown>>();
  // The wipe generation each conversation's running task started under.
  private readonly taskGenerations = new Map<ConversationId, number>();

  constructor(
    private readonly factory: GroupSessionFactory,
    private readonly storage: GroupSessionStorage,
    private readonly deviceId: DeviceId,
    private readonly problems: Pick<GroupProblemTracker, 'mark'>,
  ) {}

  /** Runs `task` alone for this device and conversation, across tabs too, on a session as new as the saved one. */
  runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T> {
    const locked = async () =>
      withCrossTabLock(`mls:${this.deviceId}:${conversationId}`, async () => {
        this.taskGenerations.set(conversationId, currentWipeGeneration());
        await this.dropIfStale(conversationId);
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

  /** The cached or restored session; throws GroupStateUnavailableError when none is saved. */
  async get(conversationId: ConversationId): Promise<GroupSession> {
    const cached = this.sessions.get(conversationId);
    if (cached) return cached;

    let stateBytes: Uint8Array | undefined;
    try {
      stateBytes = await this.storage.load(conversationId);
    } catch (error) {
      if (!(error instanceof UnreadableRecordError)) throw error;
      return this.refuseUnreadable(conversationId, error);
    }
    if (!stateBytes) throw new GroupStateUnavailableError(conversationId);

    let session: GroupSession;
    try {
      session = await this.factory.restore(conversationId, stateBytes);
    } catch (error) {
      // Saved bytes that will not restore are still a group: never "no group", or a rejoin would overwrite them.
      return this.refuseUnreadable(conversationId, error);
    }
    this.sessions.set(conversationId, session);
    return session;
  }

  /** The cached session, without touching storage. */
  peek(conversationId: ConversationId): GroupSession | undefined {
    return this.sessions.get(conversationId);
  }

  /** Caches a session already in step with saved state. */
  set(conversationId: ConversationId, session: GroupSession): void {
    this.sessions.set(conversationId, session);
  }

  /** Persists first, then caches: a session that failed to save must not linger in memory. */
  async adopt(conversationId: ConversationId, session: GroupSession): Promise<void> {
    await this.persist(conversationId, session);
    this.sessions.set(conversationId, session);
  }

  async persist(conversationId: ConversationId, session: GroupSession): Promise<void> {
    const stateBytes = await session.serialize();
    this.assertNotWiped(conversationId);
    // Stamp first: a crash between the two writes leaves the older, still consistent state for other tabs.
    const stamp = crypto.randomUUID();
    try {
      await this.storage.save(versionKey(conversationId), new TextEncoder().encode(stamp));
      await this.storage.save(conversationId, stateBytes);
    } catch (error) {
      this.drop(conversationId);
      throw error;
    }
    this.versions.set(conversationId, stamp);
  }

  drop(conversationId: ConversationId): void {
    this.sessions.delete(conversationId);
    this.versions.delete(conversationId);
  }

  dropAll(): void {
    this.sessions.clear();
    this.versions.clear();
  }

  /** Drops the cached session and deletes the saved state and its stamp. */
  async forget(conversationId: ConversationId): Promise<void> {
    this.drop(conversationId);
    await this.storage.delete(conversationId);
    await this.storage.delete(versionKey(conversationId));
  }

  /** Throws when local MLS data was wiped since the running task for this conversation started. */
  assertNotWiped(conversationId: ConversationId): void {
    assertGenerationCurrent(this.taskGenerations.get(conversationId) ?? currentWipeGeneration());
  }

  /** The saved epoch, or undefined when there is no saved session; throws when one exists but cannot be used. */
  async savedEpoch(conversationId: ConversationId): Promise<Epoch | undefined> {
    try {
      return await (await this.get(conversationId)).currentEpoch();
    } catch (error) {
      if (error instanceof GroupStateUnavailableError) return undefined;
      throw error;
    }
  }

  /** Like savedEpoch, but state that cannot be read counts as absent. */
  async savedEpochIgnoringCorruption(conversationId: ConversationId): Promise<Epoch | undefined> {
    try {
      return await this.savedEpoch(conversationId);
    } catch (error) {
      if (error instanceof GroupStateCorruptedError) return undefined;
      throw error;
    }
  }

  private refuseUnreadable(conversationId: ConversationId, cause: unknown): never {
    this.problems.mark(conversationId, 'state-unreadable');
    throw new GroupStateCorruptedError(conversationId, cause);
  }

  private async dropIfStale(conversationId: ConversationId): Promise<void> {
    const saved = await this.storage.load(versionKey(conversationId)).catch((error: unknown) => {
      if (error instanceof UnreadableRecordError) return undefined;
      throw error;
    });
    const stamp = saved ? new TextDecoder().decode(saved) : undefined;

    if (this.versions.get(conversationId) !== stamp) this.sessions.delete(conversationId);
    this.versions.set(conversationId, stamp);
  }
}
