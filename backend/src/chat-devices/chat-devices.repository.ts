import { Injectable } from '@nestjs/common';
import { MlsKeyPackageKind } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NewKeyPackage {
  kind: MlsKeyPackageKind;
  payload: Uint8Array;
  expiresAt: Date;
}

@Injectable()
export class ChatDevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(deviceId: string) {
    return this.prisma.chatDevice.findUnique({ where: { id: deviceId } });
  }

  findUserMessagingProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, messageRequestSetting: true },
    });
  }

  async createDeviceWithKeyPackages(params: {
    deviceId: string;
    userId: string;
    signaturePublicKey: Uint8Array;
    ciphersuite: string;
    keyPackages: NewKeyPackage[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.chatDevice.create({
        data: {
          id: params.deviceId,
          userId: params.userId,
          // .slice() pins the exact ArrayBuffer-backed Uint8Array type
          // Prisma's Bytes fields want, regardless of what backed the
          // input (Buffer, a view over a larger buffer, etc.)
          signaturePublicKey: params.signaturePublicKey.slice(),
          ciphersuite: params.ciphersuite,
        },
      });

      await tx.mlsKeyPackage.createMany({
        data: params.keyPackages.map((kp) => ({
          deviceId: device.id,
          kind: kp.kind,
          payload: kp.payload.slice(),
          expiresAt: kp.expiresAt,
        })),
      });

      return device;
    });
  }

  addKeyPackages(deviceId: string, keyPackages: NewKeyPackage[]) {
    return this.prisma.mlsKeyPackage.createMany({
      data: keyPackages.map((kp) => ({
        deviceId,
        kind: kp.kind,
        payload: kp.payload.slice(),
        expiresAt: kp.expiresAt,
      })),
    });
  }

  findActiveDevicesForUser(userId: string) {
    return this.prisma.chatDevice.findMany({
      where: { userId, revokedAt: null },
    });
  }

  /**
   * Atomically claims one SINGLE_USE, unexpired key package belonging to
   * any of the user's active devices (claim-once, critique C1) - the same
   * find-then-guarded-updateMany pattern already established for
   * MediaUpload claims (see MediaRepository/claimUploadsForAttachment).
   *
   * Bounded retry: if a concurrent request wins the race for the row this
   * call picked, it tries the next-oldest candidate instead of failing
   * outright - a real but rare case (two adds targeting the same user at
   * the same instant), not worth a raw-SQL FOR UPDATE SKIP LOCKED for v1.
   */
  async claimSingleUseKeyPackage(userId: string, claimedByUserId: string) {
    const triedIds: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.prisma.mlsKeyPackage.findFirst({
        where: {
          kind: 'SINGLE_USE',
          claimedAt: null,
          expiresAt: { gt: new Date() },
          device: { userId, revokedAt: null },
          ...(triedIds.length > 0 ? { id: { notIn: triedIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!candidate) {
        return null;
      }

      const claimed = await this.prisma.mlsKeyPackage.updateMany({
        // re-checking device.revokedAt here, not just on the earlier
        // findFirst, closes the window where a revocation landing between
        // the read and this write would otherwise still let the claim
        // through
        where: {
          id: candidate.id,
          claimedAt: null,
          device: { revokedAt: null },
        },
        data: { claimedAt: new Date(), claimedByUserId },
      });

      if (claimed.count === 1) {
        return this.prisma.mlsKeyPackage.findUnique({
          where: { id: candidate.id },
        });
      }

      triedIds.push(candidate.id);
    }

    return null;
  }

  findLastResortKeyPackage(userId: string) {
    return this.prisma.mlsKeyPackage.findFirst({
      where: {
        kind: 'LAST_RESORT',
        expiresAt: { gt: new Date() },
        device: { userId, revokedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  revokeDevice(deviceId: string, userId: string) {
    return this.prisma.chatDevice.updateMany({
      where: { id: deviceId, userId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Bulk-deletes expired key packages. No external resource to release
   * first (unlike MediaUpload/Cloudinary) - a plain deleteMany is safe and
   * needs no per-row claim/batch loop.
   */
  async deleteExpiredKeyPackages(): Promise<number> {
    const result = await this.prisma.mlsKeyPackage.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
