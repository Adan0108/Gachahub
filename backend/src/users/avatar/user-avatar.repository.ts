import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { claimUploadsForAttachment } from '../../media/media.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ME_SELECT } from '../me-select';

// Thrown inside the transaction on a CAS miss so Prisma rolls the upload claim back too; the service maps it to a 409.
export class AvatarConflictError extends Error {}

type AvatarWrite = { image: string | null; avatarMediaUploadId: string | null };

@Injectable()
export class UserAvatarRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Claims the upload and points the avatar at it in one transaction; previousUploadId is what the caller must release.
  replace(userId: string, upload: { id: string; secureUrl: string }) {
    return this.prisma.$transaction(async (tx) => {
      await claimUploadsForAttachment(tx, {
        ids: [upload.id],
        userId,
        purpose: 'AVATAR',
      });

      return this.swap(tx, userId, {
        image: upload.secureUrl,
        avatarMediaUploadId: upload.id,
      });
    });
  }

  // Also clears a legacy `image` that has no backing upload.
  clear(userId: string) {
    return this.prisma.$transaction((tx) =>
      this.swap(tx, userId, { image: null, avatarMediaUploadId: null }),
    );
  }

  // CAS on the upload id read first in this tx, so a concurrent replace/clear makes this one lose instead of overwriting.
  private async swap(
    tx: Prisma.TransactionClient,
    userId: string,
    data: AvatarWrite,
  ) {
    const { avatarMediaUploadId: previousUploadId } =
      await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarMediaUploadId: true },
      });

    const result = await tx.user.updateMany({
      where: { id: userId, avatarMediaUploadId: previousUploadId },
      data,
    });

    if (result.count === 0) {
      throw new AvatarConflictError();
    }

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: ME_SELECT,
    });

    return { user, previousUploadId };
  }
}
