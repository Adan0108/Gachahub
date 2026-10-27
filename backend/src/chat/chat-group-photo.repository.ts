import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { claimUploadsForAttachment } from '../media/media.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  GROUP_MEMBER_ROLES,
  inTransactionAsRole,
} from './membership/lock-conversation';

// Thrown inside the transaction on a CAS miss so Prisma rolls the upload claim back too; the service maps it to a 409.
export class GroupPhotoConflictError extends Error {}

type PhotoWrite = {
  photoUrl: string | null;
  photoMediaUploadId: string | null;
};

@Injectable()
export class ChatGroupPhotoRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Claims the upload and points the group at it in one transaction; previousUploadId is what the caller must release.
  replace(
    conversationId: string,
    userId: string,
    upload: { id: string; secureUrl: string },
  ) {
    return inTransactionAsRole(
      this.prisma,
      conversationId,
      userId,
      GROUP_MEMBER_ROLES,
      async (tx) => {
        await claimUploadsForAttachment(tx, {
          ids: [upload.id],
          userId,
          purpose: 'GROUP_PHOTO',
        });

        return this.swap(tx, conversationId, {
          photoUrl: upload.secureUrl,
          photoMediaUploadId: upload.id,
        });
      },
    );
  }

  // Also clears a legacy `photoUrl` that has no backing upload.
  clear(conversationId: string, userId: string) {
    return inTransactionAsRole(
      this.prisma,
      conversationId,
      userId,
      GROUP_MEMBER_ROLES,
      (tx) =>
        this.swap(tx, conversationId, {
          photoUrl: null,
          photoMediaUploadId: null,
        }),
    );
  }

  // CAS on the upload id read first in this tx, so a concurrent replace/clear makes this one lose instead of overwriting.
  private async swap(
    tx: Prisma.TransactionClient,
    conversationId: string,
    data: PhotoWrite,
  ) {
    const { photoMediaUploadId: previousUploadId } =
      await tx.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { photoMediaUploadId: true },
      });

    const result = await tx.chatConversation.updateMany({
      where: { id: conversationId, photoMediaUploadId: previousUploadId },
      data,
    });

    if (result.count === 0) {
      throw new GroupPhotoConflictError();
    }

    const conversation = await tx.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    return { conversation, previousUploadId };
  }
}
