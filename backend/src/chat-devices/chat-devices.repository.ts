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
   * the given active device (claim-once, critique C1) - the same
   * find-then-guarded-updateMany pattern already established for
   * MediaUpload claims (see MediaRepository/claimUploadsForAttachment).
   *
   * Retries against the next-oldest untried candidate whenever a concurrent
   * request wins the race for the row this call picked, until the pool is
   * genuinely exhausted (each attempt permanently excludes one id via
   * triedIds, so this always terminates) - a fixed retry cap would let
   * ordinary contention on a popular device's pool silently fall back to the
   * reused LAST_RESORT package while real unclaimed SINGLE_USE packages
   * still existed. MAX_CLAIM_ATTEMPTS is a defensive ceiling against a
   * runaway loop, not an expected limit.
   */
  async claimSingleUseKeyPackage(deviceId: string, claimedByUserId: string) {
    const triedIds: string[] = [];
    const MAX_CLAIM_ATTEMPTS = 1000;

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const candidate = await this.prisma.mlsKeyPackage.findFirst({
        where: {
          deviceId,
          kind: 'SINGLE_USE',
          claimedAt: null,
          expiresAt: { gt: new Date() },
          device: { revokedAt: null },
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

  findLastResortKeyPackage(deviceId: string) {
    return this.prisma.mlsKeyPackage.findFirst({
      where: {
        deviceId,
        kind: 'LAST_RESORT',
        expiresAt: { gt: new Date() },
        device: { revokedAt: null },
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
