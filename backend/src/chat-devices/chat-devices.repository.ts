import { Injectable } from '@nestjs/common';
import { MlsKeyPackageKind, type ChatDevice } from '../generated/prisma/client';
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

  /** Own devices, newest first; revoked ones only if revoked since `revokedSince`. */
  listOwnDevices(userId: string, revokedSince: Date) {
    return this.prisma.chatDevice.findMany({
      where: {
        userId,
        OR: [{ revokedAt: null }, { revokedAt: { gte: revokedSince } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ciphersuite: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    });
  }

  findUserMessagingProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, messageRequestSetting: true },
    });
  }

  /** Registers under the user's row lock (NO KEY UPDATE, so FK inserts are not blocked), so concurrent registrations cannot overshoot the cap. */
  async createDeviceWithinCap(
    params: {
      deviceId: string;
      userId: string;
      signaturePublicKey: Uint8Array;
      ciphersuite: string;
      keyPackages: NewKeyPackage[];
    },
    cap: { maxActive: number; evictIdleBefore: Date },
  ): Promise<
    | { outcome: 'created'; device: ChatDevice }
    | { outcome: 'exists' }
    | { outcome: 'cap-reached' }
  > {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${params.userId} FOR NO KEY UPDATE`;

      const existing = await tx.chatDevice.findUnique({
        where: { id: params.deviceId },
        select: { id: true },
      });
      if (existing) {
        return { outcome: 'exists' as const };
      }

      const active = await tx.chatDevice.count({
        where: { userId: params.userId, revokedAt: null },
      });
      if (active >= cap.maxActive) {
        const stalest = await tx.chatDevice.findFirst({
          where: { userId: params.userId, revokedAt: null },
          orderBy: { lastSeenAt: 'asc' },
          select: { id: true, lastSeenAt: true },
        });
        if (!stalest || stalest.lastSeenAt >= cap.evictIdleBefore) {
          return { outcome: 'cap-reached' as const };
        }

        await tx.chatDevice.updateMany({
          where: { id: stalest.id, userId: params.userId },
          data: { revokedAt: new Date() },
        });
      }

      const device = await tx.chatDevice.create({
        data: {
          id: params.deviceId,
          userId: params.userId,
          // .slice() gives Prisma's Bytes fields an exact ArrayBuffer-backed Uint8Array
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

      return { outcome: 'created' as const, device };
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

  touchLastSeen(deviceId: string) {
    return this.prisma.chatDevice.updateMany({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
    });
  }

  /** Retires every device unseen since `cutoff`; returns how many. */
  async retireDevicesUnseenSince(cutoff: Date): Promise<number> {
    const result = await this.prisma.chatDevice.updateMany({
      where: { revokedAt: null, lastSeenAt: { lt: cutoff } },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  findActiveDevicesForUser(userId: string) {
    return this.prisma.chatDevice.findMany({
      where: { userId, revokedAt: null },
    });
  }

  /** Atomically claims one unexpired SINGLE_USE key package of the active device, retrying past concurrent claimers until the pool is exhausted. */
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
        // re-checks device.revokedAt so a revocation between read and write blocks the claim
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

  countClaimableSingleUseKeyPackages(deviceId: string): Promise<number> {
    return this.prisma.mlsKeyPackage.count({
      where: {
        deviceId,
        kind: 'SINGLE_USE',
        claimedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
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

  /** Ties a login to its browser's chat device, once; only relinkSession moves it, and only off a dead device. */
  linkSession(sessionId: string, userId: string, deviceId: string) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, userId, chatDeviceId: null },
      data: { chatDeviceId: deviceId },
    });
  }

  /** Repoints a login linked to a revoked or gone device to a live one. */
  relinkSession(
    sessionId: string,
    userId: string,
    deviceId: string,
    currentDeviceId: string | null,
  ) {
    return this.prisma.session.updateMany({
      // Conditional on the device seen when deciding, so a concurrent relink is not overwritten.
      where: { id: sessionId, userId, chatDeviceId: currentDeviceId },
      data: { chatDeviceId: deviceId },
    });
  }

  async findSessionDeviceId(
    sessionId: string,
    userId: string,
  ): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { chatDeviceId: true },
    });

    return session?.chatDeviceId ?? null;
  }

  /** Retires a device for good (its identity is being replaced); it can never be used again. */
  revokeDevice(deviceId: string, userId: string) {
    return this.prisma.chatDevice.updateMany({
      where: { id: deviceId, userId },
      data: { revokedAt: new Date() },
    });
  }

  /** Logins to end when a device is signed out: those linked to it, plus the caller's own only if linked to it. */
  async findLoginsOfDevice(
    deviceId: string,
    userId: string,
    callerSessionId: string,
  ): Promise<Array<{ id: string; token: string }>> {
    const caller = await this.prisma.session.findFirst({
      where: { id: callerSessionId, userId },
      select: { chatDeviceId: true },
    });
    const signingOutOwnDevice = caller?.chatDeviceId === deviceId;

    return this.prisma.session.findMany({
      where: {
        userId,
        chatDeviceId: deviceId,
        ...(signingOutOwnDevice ? {} : { id: { not: callerSessionId } }),
      },
      select: { id: true, token: true },
    });
  }

  /** Bulk-deletes expired key packages. */
  async deleteExpiredKeyPackages(): Promise<number> {
    const result = await this.prisma.mlsKeyPackage.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
