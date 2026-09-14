import { ConflictException, Injectable } from '@nestjs/common';
import type {
  MediaPurpose,
  MediaResourceType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

/**
 * Atomically claims uploads for attachment (UPLOADED -> ATTACHED) in the
 * caller's own transaction, so the claim and the caller's own insert
 * (PostMedia/ChatMessageMedia row) either both commit or both roll back.
 *
 * Throws if any id couldn't be claimed - already attached, wrong
 * owner/purpose, or gone - so a message/post can never end up with only
 * some of its media attached.
 */
export async function claimUploadsForAttachment(
  tx: PrismaTransaction,
  params: { ids: string[]; userId: string; purpose: MediaPurpose },
): Promise<void> {
  const claimed = await tx.mediaUpload.updateMany({
    where: {
      id: { in: params.ids },
      userId: params.userId,
      purpose: params.purpose,
      status: 'UPLOADED',
    },
    data: {
      status: 'ATTACHED',
      attachedAt: new Date(),
    },
  });

  if (claimed.count !== params.ids.length) {
    throw new ConflictException(
      'One or more media uploads could not be attached',
    );
  }
}

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  createInitiatedUpload(params: {
    userId: string;
    purpose: MediaPurpose;
    resourceType: MediaResourceType;
    publicId: string;
  }) {
    return this.prisma.mediaUpload.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        resourceType: params.resourceType,
        publicId: params.publicId,
        status: 'INITIATED',
      },
    });
  }

  findById(id: string) {
    return this.prisma.mediaUpload.findUnique({
      where: { id },
    });
  }

  findManyByIds(ids: string[]) {
    return this.prisma.mediaUpload.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  markUploaded(params: {
    id: string;
    assetId: string;
    secureUrl: string;
    version: number;
    format: string;
    bytes: number;
    width?: number;
    height?: number;
    duration?: number;
    responseSignature: string;
  }) {
    return this.prisma.mediaUpload.update({
      where: {
        id: params.id,
      },
      data: {
        status: 'UPLOADED',
        assetId: params.assetId,
        secureUrl: params.secureUrl,
        version: params.version,
        format: params.format,
        bytes: params.bytes,
        width: params.width,
        height: params.height,
        duration: params.duration,
        responseSignature: params.responseSignature,
        uploadedAt: new Date(),
      },
    });
  }

  markDeleted(id: string) {
    return this.prisma.mediaUpload.update({
      where: { id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });
  }

  markFailed(id: string) {
    return this.prisma.mediaUpload.update({
      where: { id },
      data: {
        status: 'FAILED',
      },
    });
  }

  findExpiredUploads(normalCutoff: Date, cleaningCutoff: Date, take = 100) {
    return this.prisma.mediaUpload.findMany({
      where: {
        OR: [
          {
            status: {
              in: ['INITIATED', 'UPLOADED'],
            },
            createdAt: {
              lt: normalCutoff,
            },
          },
          {
            status: 'CLEANING',
            updatedAt: {
              lt: cleaningCutoff,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
      take,
    });
  }
  claimForCleanup(id: string) {
    return this.prisma.mediaUpload.updateMany({
      where: {
        id,
        status: {
          in: ['INITIATED', 'UPLOADED'],
        },
      },
      data: {
        status: 'CLEANING',
      },
    });
  }

  reclaimStaleCleanup(id: string, cleaningCutoff: Date) {
    return this.prisma.mediaUpload.updateMany({
      where: {
        id,
        status: 'CLEANING',
        updatedAt: {
          lt: cleaningCutoff,
        },
      },
      data: {
        status: 'CLEANING',
      },
    });
  }

  /**
   * Helper for feature repositories that need to attach uploads in their
   * own Prisma transaction.
   */
  getPrisma(): PrismaService {
    return this.prisma;
  }
}
