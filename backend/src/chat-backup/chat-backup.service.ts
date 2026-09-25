import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  CHALLENGE_NONCE_BYTES,
  CHALLENGE_TTL_MS,
  DEFAULT_PAGE_SIZE,
  DELETION_DELAY_MS,
  MAX_BLOB_BYTES,
  MAX_KEY_CHECK_BYTES,
  MAX_SECRET_BYTES,
  MIN_KEY_CHECK_BYTES,
  MIN_SECRET_BYTES,
  USER_QUOTA_BYTES,
} from './chat-backup.constants';
import { ChatBackupRateLimiterService } from './chat-backup-rate-limiter.service';
import {
  ChatBackupRepository,
  type BlobCursor,
  type NewBlob,
} from './chat-backup.repository';
import type { PutBackupKeyDto } from './dto/put-backup-key.dto';
import type { BackupBlobItemDto } from './dto/upload-blobs.dto';
import {
  computeBackupProof,
  proofMatches,
  type ProofAction,
} from './replace-proof';
import type { BackupProofDto } from './dto/backup-proof.dto';
import type { DeleteBackupDto } from './dto/delete-backup.dto';

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function decodeBounded(
  base64: string,
  min: number,
  max: number,
  field: string,
): Buffer {
  const bytes = Buffer.from(base64, 'base64');

  if (bytes.length < min || bytes.length > max) {
    throw new BadRequestException(`${field} has an invalid size`);
  }

  return bytes;
}

export function encodeCursor(cursor: BlobCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string): BlobCursor {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const createdAt = new Date(iso);

  if (!id || rest.length > 0 || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Invalid cursor');
  }

  return { createdAt, id };
}

@Injectable()
export class ChatBackupService {
  constructor(
    private readonly repository: ChatBackupRepository,
    private readonly rateLimiter: ChatBackupRateLimiterService,
  ) {}

  async getStatus(userId: string) {
    const key = await this.repository.findKey(userId);

    if (!key) {
      return { enabled: false, keyCheck: null, blobCount: 0, bytesUsed: 0 };
    }

    return {
      enabled: true,
      keyCheck: toBase64(key.keyCheck),
      deletionScheduledFor: key.deletionScheduledAt?.toISOString() ?? null,
      ...(await this.repository.usage(userId)),
    };
  }

  /** Turns backup on; replacing an existing key needs `replace: true` plus a proof (see replace-proof.ts). */
  async putKey(userId: string, dto: PutBackupKeyDto) {
    this.rateLimiter.assertCanManage(userId);
    const keyCheck = decodeBounded(
      dto.keyCheck,
      MIN_KEY_CHECK_BYTES,
      MAX_KEY_CHECK_BYTES,
      'keyCheck',
    );
    const secret = decodeBounded(
      dto.replaceSecret,
      MIN_SECRET_BYTES,
      MAX_SECRET_BYTES,
      'replaceSecret',
    );
    const existing = await this.repository.findKey(userId);

    if (!existing) {
      if (!(await this.repository.createKey(userId, keyCheck, secret))) {
        throw new ConflictException('Backup is already turned on');
      }

      return { enabled: true };
    }

    if (dto.replace !== true) {
      throw new ConflictException(
        'Backup is already on; replacing its key deletes every stored blob and needs replace: true',
      );
    }

    await this.assertProof(userId, existing.replaceSecret, 'replace', dto, {
      keyCheck: dto.keyCheck,
      replaceSecret: dto.replaceSecret,
    });
    await this.repository.replaceKey(userId, keyCheck, secret);

    return { enabled: true };
  }

  async issueChallenge(userId: string) {
    this.rateLimiter.assertCanManage(userId);
    const nonce = randomBytes(CHALLENGE_NONCE_BYTES);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    if (!(await this.repository.issueChallenge(userId, nonce, expiresAt))) {
      throw new ConflictException('Backup is not turned on');
    }

    return { nonce: toBase64(nonce) };
  }

  /** With a valid proof deletes at once; without one only schedules deletion, which a proof can cancel. */
  async disable(userId: string, dto: DeleteBackupDto) {
    this.rateLimiter.assertCanDestroy(userId);
    const existing = await this.repository.findKey(userId);

    if (dto.nonce || dto.proof) {
      if (existing) {
        await this.assertProof(userId, existing.replaceSecret, 'delete', dto);
      }
      await this.repository.deleteAll(userId);

      return { enabled: false, deletionScheduledFor: null };
    }
    if (!existing) {
      return { enabled: false, deletionScheduledFor: null };
    }

    const scheduled =
      existing.deletionScheduledAt ?? new Date(Date.now() + DELETION_DELAY_MS);
    await this.repository.scheduleDeletion(userId, scheduled);

    return { enabled: true, deletionScheduledFor: scheduled.toISOString() };
  }

  async cancelDeletion(userId: string, dto: BackupProofDto) {
    this.rateLimiter.assertCanManage(userId);
    const existing = await this.repository.findKey(userId);

    if (!existing) {
      throw new ConflictException('Backup is not turned on');
    }

    await this.assertProof(
      userId,
      existing.replaceSecret,
      'cancel-delete',
      dto,
    );
    await this.repository.cancelDeletion(userId);

    return { enabled: true, deletionScheduledFor: null };
  }

  async uploadBlobs(userId: string, items: BackupBlobItemDto[]) {
    this.rateLimiter.assertCanUpload(userId);

    // Cheap early answer so a client with backup off gets 409, not a misleading 403 below.
    if (!(await this.repository.findKey(userId))) {
      throw new ConflictException('Backup is not turned on');
    }

    const unique = [...new Map(items.map((i) => [i.messageId, i])).values()];
    const blobs = this.decodeBlobs(unique);
    await this.assertOwnsMessages(userId, blobs);

    const result = await this.repository.storeWithinQuota(
      userId,
      blobs,
      USER_QUOTA_BYTES,
    );

    if (result.status === 'no-key') {
      throw new ConflictException('Backup is not turned on');
    }
    if (result.status === 'over-quota') {
      throw new PayloadTooLargeException('Backup storage quota exceeded');
    }

    return { stored: result.stored, skipped: items.length - result.stored };
  }

  async listBlobs(userId: string, after?: string, limit?: number) {
    this.rateLimiter.assertCanDownload(userId);
    const take = limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.repository.findPage(
      userId,
      after ? decodeCursor(after) : null,
      take + 1,
    );
    const page = rows.slice(0, take);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        conversationId: row.conversationId,
        messageId: row.messageId,
        ciphertext: toBase64(row.ciphertext),
      })),
      nextCursor:
        rows.length > take && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  private decodeBlobs(items: BackupBlobItemDto[]): NewBlob[] {
    return items.map((item) => {
      const ciphertext = Buffer.from(item.ciphertext, 'base64');

      if (ciphertext.length === 0 || ciphertext.length > MAX_BLOB_BYTES) {
        throw new BadRequestException(
          `Each blob must be 1 to ${MAX_BLOB_BYTES} bytes`,
        );
      }

      return {
        conversationId: item.conversationId,
        messageId: item.messageId,
        ciphertext,
        size: ciphertext.length,
      };
    });
  }

  private async assertOwnsMessages(userId: string, blobs: NewBlob[]) {
    const conversationIds = [...new Set(blobs.map((b) => b.conversationId))];
    const [participated, valid] = await Promise.all([
      this.repository.findParticipatedConversations(userId, conversationIds),
      this.repository.findMessagesInConversations(blobs),
    ]);

    if (blobs.some((b) => !participated.has(b.conversationId))) {
      throw new ForbiddenException('Not a participant of that conversation');
    }
    if (blobs.some((b) => !valid.has(b.messageId))) {
      throw new BadRequestException(
        'A message does not belong to its conversation',
      );
    }
  }

  private async assertProof(
    userId: string,
    storedSecret: Uint8Array | null,
    action: ProofAction,
    dto: BackupProofDto,
    bound: { keyCheck?: string; replaceSecret?: string } = {},
  ) {
    if (!storedSecret) {
      throw new ForbiddenException(
        'This backup has no proof secret: schedule its deletion instead',
      );
    }
    if (!dto.nonce || !dto.proof) {
      throw new ForbiddenException('This needs a nonce and proof');
    }

    // Consumed before the proof is checked, so a wrong guess burns the challenge.
    const nonce = Buffer.from(dto.nonce, 'base64');
    if (!(await this.repository.consumeChallenge(userId, nonce, new Date()))) {
      throw new ForbiddenException('The challenge is missing, used or expired');
    }

    const expected = computeBackupProof(storedSecret, action, {
      userId,
      nonce: dto.nonce,
      ...bound,
    });

    if (!proofMatches(expected, Buffer.from(dto.proof, 'base64'))) {
      throw new ForbiddenException('The proof does not match the current key');
    }
  }
}
