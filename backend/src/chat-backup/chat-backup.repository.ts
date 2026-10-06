import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { ENTITLED_TO_LEAF_STATES } from '../chat/membership/leaf-entitlement';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeBackupProof,
  proofMatches,
  type ProofAction,
} from './replace-proof';

export interface BlobRow {
  conversationId: string;
  messageId: string;
  ciphertext: Uint8Array;
}

export interface NewBlob extends BlobRow {
  size: number;
}

export interface BlobCursor {
  createdAt: Date;
  id: string;
}

export interface BlobPageRow extends BlobRow {
  id: string;
  createdAt: Date;
}

type PrismaBytes = Uint8Array<ArrayBuffer>;

export type StoreResult =
  | { status: 'stored'; stored: number }
  | { status: 'no-key' }
  | { status: 'over-quota' };

/** Entitled states (PENDING invitees read real history too) plus LEAVING; DECLINED and no row never could have. */
const BACKUP_ELIGIBLE_STATES = [...ENTITLED_TO_LEAF_STATES, 'LEAVING'] as const;

/** Serialises every write that touches one user's backup (key, blobs, quota) for the rest of the transaction. */
async function lockUserBackup(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chat-backup:' + userId}))`;
}

@Injectable()
export class ChatBackupRepository {
  constructor(private readonly prisma: PrismaService) {}

  findKey(userId: string) {
    return this.prisma.chatBackupKey.findUnique({
      where: { userId },
      select: {
        keyCheck: true,
        replaceSecret: true,
        deletionScheduledAt: true,
      },
    });
  }

  /** False when a key already exists; the primary key makes the create atomic. */
  async createKey(
    userId: string,
    keyCheck: Uint8Array,
    replaceSecret: Uint8Array,
  ): Promise<boolean> {
    const result = await this.prisma.chatBackupKey.createMany({
      data: [
        {
          userId,
          keyCheck: keyCheck as PrismaBytes,
          replaceSecret: replaceSecret as PrismaBytes,
        },
      ],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  /** False when the user has no key row to hang the challenge on. */
  async issueChallenge(
    userId: string,
    nonce: Uint8Array,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.chatBackupKey.updateMany({
      where: { userId },
      data: {
        challengeNonce: nonce as PrismaBytes,
        challengeExpiresAt: expiresAt,
      },
    });

    return result.count === 1;
  }

  /** Single use: true only for the one caller that clears a live, matching challenge. */
  async consumeChallenge(
    userId: string,
    nonce: Uint8Array,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.chatBackupKey.updateMany({
      where: {
        userId,
        challengeNonce: nonce as PrismaBytes,
        challengeExpiresAt: { gt: now },
      },
      data: { challengeNonce: null, challengeExpiresAt: null },
    });

    return result.count === 1;
  }

  /** With `dueBefore`, deletes only if the schedule is still due once the lock is held; false when skipped. */
  async deleteAll(userId: string, dueBefore?: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserBackup(tx, userId);

      if (dueBefore) {
        const due = await tx.chatBackupKey.count({
          where: { userId, deletionScheduledAt: { lte: dueBefore } },
        });

        if (due === 0) return false;
      }

      await tx.chatBackupBlob.deleteMany({ where: { userId } });
      await tx.chatBackupKey.deleteMany({ where: { userId } });

      return true;
    });
  }

  /**
   * Re-reads the stored secret, consumes the challenge, and verifies the
   * proof - all under the per-user lock, immediately before `mutate` runs in
   * the same transaction. Verifying inside the lock (instead of against an
   * earlier unlocked read, as `putKey`/`disable` used to) means the secret
   * checked is guaranteed still current when `mutate` executes: two requests
   * that both read the old secret can no longer each pass verification and
   * have the second one silently act using proof for a key that is no longer
   * current (or, for delete, act on a backup created after an earlier
   * unlocked "no key" read, with no proof at all).
   */
  async verifyProofAndMutate<T>(
    userId: string,
    params: {
      action: ProofAction;
      nonce: string;
      proof: string;
      bound?: { keyCheck?: string; replaceSecret?: string };
      now: Date;
    },
    mutate: (
      tx: Prisma.TransactionClient,
      currentSecret: Uint8Array,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserBackup(tx, userId);

      const current = await tx.chatBackupKey.findUnique({
        where: { userId },
        select: { replaceSecret: true },
      });

      if (!current?.replaceSecret) {
        throw new ForbiddenException(
          'This backup has no proof secret: schedule its deletion instead',
        );
      }

      const nonceBytes = Buffer.from(params.nonce, 'base64') as PrismaBytes;
      const consumed = await tx.chatBackupKey.updateMany({
        where: {
          userId,
          challengeNonce: nonceBytes,
          challengeExpiresAt: { gt: params.now },
        },
        data: { challengeNonce: null, challengeExpiresAt: null },
      });

      if (consumed.count !== 1) {
        throw new ForbiddenException(
          'The challenge is missing, used or expired',
        );
      }

      const expected = computeBackupProof(
        current.replaceSecret,
        params.action,
        { userId, nonce: params.nonce, ...params.bound },
      );

      if (!proofMatches(expected, Buffer.from(params.proof, 'base64'))) {
        throw new ForbiddenException(
          'The proof does not match the current key',
        );
      }

      return mutate(tx, current.replaceSecret);
    });
  }

  /** Sets the schedule only when none exists, so repeat requests never push it back. */
  async scheduleDeletion(userId: string, at: Date): Promise<void> {
    await this.prisma.chatBackupKey.updateMany({
      where: { userId, deletionScheduledAt: null },
      data: { deletionScheduledAt: at },
    });
  }

  async cancelDeletion(userId: string): Promise<void> {
    await this.prisma.chatBackupKey.updateMany({
      where: { userId },
      data: { deletionScheduledAt: null },
    });
  }

  async findDueDeletions(now: Date, take: number): Promise<string[]> {
    const rows = await this.prisma.chatBackupKey.findMany({
      where: { deletionScheduledAt: { lte: now } },
      select: { userId: true },
      take,
    });

    return rows.map((row) => row.userId);
  }

  /** Key check, dedupe, quota check and insert under the user's advisory lock, so races cannot overshoot or orphan blobs. */
  async storeWithinQuota(
    userId: string,
    blobs: NewBlob[],
    quotaBytes: number,
  ): Promise<StoreResult> {
    return this.prisma.$transaction(async (tx): Promise<StoreResult> => {
      await lockUserBackup(tx, userId);

      if (!(await tx.chatBackupKey.findUnique({ where: { userId } }))) {
        return { status: 'no-key' };
      }

      const existing = new Set(
        (
          await tx.chatBackupBlob.findMany({
            where: {
              userId,
              messageId: { in: blobs.map((blob) => blob.messageId) },
            },
            select: { messageId: true },
          })
        ).map((row) => row.messageId),
      );
      const fresh = blobs.filter((blob) => !existing.has(blob.messageId));
      const incoming = fresh.reduce((sum, blob) => sum + blob.size, 0);

      if (incoming === 0) {
        return { status: 'stored', stored: 0 };
      }

      const total = await tx.chatBackupBlob.aggregate({
        where: { userId },
        _sum: { size: true },
      });

      if ((total._sum.size ?? 0) + incoming > quotaBytes) {
        return { status: 'over-quota' };
      }

      const result = await tx.chatBackupBlob.createMany({
        data: fresh.map((blob) => ({
          userId,
          conversationId: blob.conversationId,
          messageId: blob.messageId,
          ciphertext: blob.ciphertext as PrismaBytes,
          size: blob.size,
        })),
        skipDuplicates: true,
      });

      return { status: 'stored', stored: result.count };
    });
  }

  async usage(
    userId: string,
  ): Promise<{ blobCount: number; bytesUsed: number }> {
    const total = await this.prisma.chatBackupBlob.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { size: true },
    });

    return { blobCount: total._count._all, bytesUsed: total._sum.size ?? 0 };
  }

  /** Read-only: the ids among `pairs` that really belong to their claimed conversation. */
  async findMessagesInConversations(
    pairs: { conversationId: string; messageId: string }[],
  ): Promise<Set<string>> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { id: { in: pairs.map((pair) => pair.messageId) } },
      select: { id: true, conversationId: true },
    });
    const claimed = new Map(pairs.map((p) => [p.messageId, p.conversationId]));

    return new Set(
      messages
        .filter((message) => claimed.get(message.id) === message.conversationId)
        .map((message) => message.id),
    );
  }

  /** Read-only: the conversations where the user's state means they could have decrypted messages. */
  async findParticipatedConversations(
    userId: string,
    conversationIds: string[],
  ): Promise<Set<string>> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: {
        userId,
        conversationId: { in: conversationIds },
        state: { in: [...BACKUP_ELIGIBLE_STATES] },
      },
      select: { conversationId: true },
    });

    return new Set(rows.map((row) => row.conversationId));
  }

  findPage(
    userId: string,
    after: BlobCursor | null,
    take: number,
  ): Promise<BlobPageRow[]> {
    return this.prisma.chatBackupBlob.findMany({
      where: {
        userId,
        ...(after && {
          OR: [
            { createdAt: { gt: after.createdAt } },
            { createdAt: after.createdAt, id: { gt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        ciphertext: true,
        createdAt: true,
      },
    });
  }
}
