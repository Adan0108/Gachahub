import { api } from '../../api';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import { GroupStateUnavailableError } from '../contract/errors';
import type { ConversationId, DeviceId, DeviceIdentity, Epoch } from '../contract/types';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import { UnreadableRecordError } from '../storage/mlsEncryptedStore';
import type { CommitVerifier } from './commitVerifier';
import { serverLogHolds } from './handshakeLog';
import { isDefinitiveRejection } from './submitErrors';

const pendingCommitKey = (conversationId: ConversationId) => `${conversationId}#pending-commit`;

export interface CommitRequest {
  deviceId: DeviceId;
  epoch: Epoch;
  payload: string;
  welcome?: { recipientDeviceIds: DeviceId[]; payload: string };
  groupInfo: string | undefined;
  addedDeviceIds: DeviceId[];
  removedDeviceIds: DeviceId[];
}

/** Who a Commit added and removed, kept to tell the thread about it. */
export interface EventChange {
  added: DeviceIdentity[];
  removed: DeviceIdentity[];
}

interface PendingCommit {
  request: CommitRequest;
  postState: string;
  change?: EventChange;
}

export interface PendingCommitHost {
  get(conversationId: ConversationId): Promise<GroupSession>;
  adopt(conversationId: ConversationId, session: GroupSession): Promise<void>;
  assertNotWiped(conversationId: ConversationId): void;
}

export type NoticeRecorder = (
  conversationId: ConversationId,
  session: GroupSession,
  commit: { change: EventChange; epoch: Epoch; at: number },
) => Promise<void>;

/** Saves a submitted Commit before it goes out and settles it later when its outcome was never seen. */
export class PendingCommitRecovery {
  // Conversations known to have no pending-Commit record, so a read need not open storage for it
  private readonly noPending = new Set<ConversationId>();

  constructor(
    private readonly host: PendingCommitHost,
    private readonly storage: GroupSessionStorage,
    private readonly factory: GroupSessionFactory,
    private readonly verifier: CommitVerifier,
    private readonly recordNotice: NoticeRecorder,
  ) {}

  forgetKnownAbsent(): void {
    this.noPending.clear();
  }

  async save(
    conversationId: ConversationId,
    request: CommitRequest,
    postState: Uint8Array,
    change: EventChange,
  ): Promise<void> {
    const pending: PendingCommit = {
      request,
      postState: bytesToBase64(postState),
      change: {
        added: change.added.map(({ userId, deviceId }) => ({ userId, deviceId })),
        removed: change.removed.map(({ userId, deviceId }) => ({ userId, deviceId })),
      },
    };
    this.host.assertNotWiped(conversationId);
    this.noPending.delete(conversationId);
    await this.storage.save(
      pendingCommitKey(conversationId),
      new TextEncoder().encode(JSON.stringify(pending)),
    );
  }

  async discard(conversationId: ConversationId): Promise<void> {
    await this.storage.delete(pendingCommitKey(conversationId));
    this.noPending.add(conversationId);
  }

  /** The notice for an accepted Commit, then the pending record - last, so anything failing before it is settled again later. */
  async finishAccepted(
    conversationId: ConversationId,
    session: GroupSession,
    change: EventChange | undefined,
    at: number,
  ): Promise<void> {
    if (change) {
      await this.recordNotice(conversationId, session, {
        change,
        epoch: await session.currentEpoch(),
        at,
      });
    }
    await this.discard(conversationId);
  }

  /** Adopts the saved post-Commit state when the server took the Commit, otherwise drops the record. */
  async resolve(conversationId: ConversationId): Promise<void> {
    if (this.noPending.has(conversationId)) return;

    const bytes = await this.storage.load(pendingCommitKey(conversationId)).catch((error: unknown) => {
      // An unreadable record is dropped below like a corrupt one
      if (error instanceof UnreadableRecordError) return new Uint8Array();
      throw error;
    });
    if (!bytes) {
      this.noPending.add(conversationId);
      return;
    }

    let pending: PendingCommit | undefined;
    try {
      pending = JSON.parse(new TextDecoder().decode(bytes)) as PendingCommit;
    } catch {
      pending = undefined;
    }

    if (
      pending &&
      (await this.isSavedEpoch(conversationId, pending.request.epoch)) &&
      (await this.serverHasCommit(conversationId, pending.request))
    ) {
      const session = await this.factory.restore(conversationId, base64ToBytes(pending.postState));
      await this.verifier.markDeclaredSeen(conversationId);
      await this.host.adopt(conversationId, session);
      await this.finishAccepted(conversationId, session, pending.change, Date.now());
      return;
    }
    await this.discard(conversationId);
  }

  private async isSavedEpoch(conversationId: ConversationId, epoch: Epoch): Promise<boolean> {
    try {
      return (await (await this.host.get(conversationId)).currentEpoch()) === epoch;
    } catch (error) {
      if (error instanceof GroupStateUnavailableError) return false;
      throw error;
    }
  }

  /** Resubmitting the same bytes gets the server's duplicate-or-conflict answer; if that fails, its own log tells. */
  private async serverHasCommit(
    conversationId: ConversationId,
    request: CommitRequest,
  ): Promise<boolean> {
    try {
      const response = await api.submitMlsHandshake(conversationId, request);
      return response.outcome === 'accepted' || response.outcome === 'duplicate';
    } catch (error) {
      if (isDefinitiveRejection(error)) return false;
      return serverLogHolds(conversationId, request);
    }
  }
}
