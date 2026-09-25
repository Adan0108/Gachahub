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

  /**
   * Ties a login to the chat device of its browser, once. A link is only ever moved afterward via
   * relinkSession below, and only when the device it currently points to is dead.
   */
  linkSession(sessionId: string, userId: string, deviceId: string) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, userId, chatDeviceId: null },
      data: { chatDeviceId: deviceId },
    });
  }

  /**
   * Repoints a login already linked to a device that's since been revoked or gone, to a live one -
   * the one case the write-once link in linkSession is allowed to move. Without this, a login
   * whose device got retired (dormancy, cap eviction) could never link a replacement: every future
   * device this browser provisions would hit the same write-once conflict forever, with no way
   * back short of signing out.
   */
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

  /**
   * The logins to end when a device is signed out: those linked to it. The
   * caller's own login is kept, unless it is linked to this device - signing
   * out the device you are in signs you out too.
   */
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
