import { Injectable } from '@nestjs/common';
import type {
  MediaPurpose,
  MediaResourceType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
