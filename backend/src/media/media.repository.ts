import { ConflictException, Injectable } from '@nestjs/common';
import type {
  MediaOpaqueKind,
  MediaPurpose,
  MediaResourceType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

/** Claims uploads UPLOADED -> ATTACHED in the caller's transaction; throws unless every id is claimed. */
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
    opaqueKind?: MediaOpaqueKind;
  }) {
    return this.prisma.mediaUpload.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        resourceType: params.resourceType,
        publicId: params.publicId,
        opaqueKind: params.opaqueKind,
        status: 'INITIATED',
      },
    });
  }

  countPendingOpaque(userId: string) {
    return this.prisma.mediaUpload.count({
      where: {
        userId,
        opaqueKind: { not: null },
        status: { in: ['INITIATED', 'UPLOADED'] },
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

  /** Flags an upload whose release failed so a retry job can pick it up; also matches RELEASE_FAILED. */
  markReleaseFailed(id: string) {
    return this.prisma.mediaUpload.updateMany({
      where: {
        id,
        status: { in: ['ATTACHED', 'RELEASE_FAILED'] },
      },
      data: {
        status: 'RELEASE_FAILED',
      },
    });
  }

  /** RELEASE_FAILED uploads whose last attempt is old enough to retry, capped by `take`. */
  findReleaseFailedUploads(retryCutoff: Date, take = 50) {
    return this.prisma.mediaUpload.findMany({
      where: {
        status: 'RELEASE_FAILED',
        updatedAt: { lt: retryCutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take,
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

  /** Attaches uploads inside a feature repository's own transaction. */
  getPrisma(): PrismaService {
    return this.prisma;
  }
}
