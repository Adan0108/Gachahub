import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { BlocksService } from '../blocks/blocks.service';
import { isEntitledToLeaf } from '../chat/membership/leaf-entitlement';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { ParticipantStateRepository } from '../mls-group-roster/participant-state.repository';
import { FollowsService } from '../follows/follows.service';
import {
  ChatDevicesRepository,
  type NewKeyPackage,
} from './chat-devices.repository';
import { KeyPackageFetchRateLimiterService } from './key-package-fetch-rate-limiter.service';
import { KeyPackageUploadRateLimiterService } from './key-package-upload-rate-limiter.service';
import {
  decodeAndVerifyKeyPackage,
  PINNED_CIPHERSUITE,
} from './mls-key-package.util';
import { SessionTerminator } from '../auth/session-terminator.service';
import { env } from '../config/env';
import { DeviceRevokedException } from '../common/exceptions/device-revoked.exception';
import { DeviceNotFoundException } from '../common/exceptions/device-not-found.exception';
import { SessionNotLinkedException } from '../common/exceptions/session-not-linked.exception';
import {
  isValidDeviceSignature,
  isValidLinkChallenge,
  issueLinkChallenge,
  SESSION_LINK_LABEL,
} from './session-link-proof';
import { LinkSessionDto } from './dto/link-session.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UploadKeyPackagesDto } from './dto/upload-key-packages.dto';
import { KeyPackageItemDto } from './dto/key-package-item.dto';

/** Keeps groups small enough that their published snapshot always fits. */
const MAX_ACTIVE_DEVICES_PER_USER = 10;
/** A device idle this long quietly gives up its slot when the cap is hit. */
const CAP_EVICTION_MIN_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** lastSeenAt is worth at most one write per device per hour. */
const LAST_SEEN_WRITE_THROTTLE_MS = 60 * 60 * 1000;

/** Revoked devices stay listed this long so the UI can show them as removed. */
const REVOKED_LISTING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ChatDevicesService {
  constructor(
    private readonly chatDevicesRepository: ChatDevicesRepository,
    private readonly followsService: FollowsService,
    private readonly blocksService: BlocksService,
    private readonly fetchRateLimiter: KeyPackageFetchRateLimiterService,
    private readonly uploadRateLimiter: KeyPackageUploadRateLimiterService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
    private readonly sessionTerminator: SessionTerminator,
    private readonly participantStates: ParticipantStateRepository,
  ) {}

  async listOwnDevices(userId: string) {
    const devices = await this.chatDevicesRepository.listOwnDevices(
      userId,
      new Date(Date.now() - REVOKED_LISTING_WINDOW_MS),
    );

    return {
      items: devices.map((device) => ({
        id: device.id,
        ciphersuite: device.ciphersuite,
        createdAt: device.createdAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString(),
        revokedAt: device.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Registers a new device; not idempotent, an existing deviceId is always a conflict. */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    this.uploadRateLimiter.assertNotRateLimited(userId);

    // The declared ciphersuite must match the pinned one, like each key package.
    if (dto.ciphersuite !== PINNED_CIPHERSUITE) {
      throw new BadRequestException(
        `Unsupported ciphersuite: expected ${PINNED_CIPHERSUITE}`,
      );
    }

    const signaturePublicKey = Uint8Array.from(
      Buffer.from(dto.signaturePublicKey, 'base64'),
    );

    const keyPackages = await this.verifyKeyPackages(
      userId,
      dto.deviceId,
      signaturePublicKey,
      dto.keyPackages,
    );

    // Bounds how many leaves one member adds to every group they are in.
    let result: Awaited<
      ReturnType<ChatDevicesRepository['createDeviceWithinCap']>
    >;
    try {
      result = await this.chatDevicesRepository.createDeviceWithinCap(
        {
          deviceId: dto.deviceId,
          userId,
          signaturePublicKey,
          ciphersuite: dto.ciphersuite,
          keyPackages,
        },
        {
          maxActive: MAX_ACTIVE_DEVICES_PER_USER,
          evictIdleBefore: new Date(Date.now() - CAP_EVICTION_MIN_IDLE_MS),
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This device id is already registered');
      }
      throw error;
    }

    if (result.outcome === 'exists') {
      throw new ConflictException('This device id is already registered');
    }
    if (result.outcome === 'cap-reached') {
      throw new ConflictException(
        `Device limit reached (${MAX_ACTIVE_DEVICES_PER_USER}) and every device was used recently - retire one first`,
      );
    }

    return result.device;
  }

  /** Tops up key packages for a device the caller owns. */
  async uploadKeyPackages(
    userId: string,
    deviceId: string,
    dto: UploadKeyPackagesDto,
  ) {
    this.uploadRateLimiter.assertNotRateLimited(userId);

    const device = await this.assertOwnActiveDevice(userId, deviceId);

    const keyPackages = await this.verifyKeyPackages(
      userId,
      device.id,
      device.signaturePublicKey,
      dto.keyPackages,
    );

    await this.chatDevicesRepository.addKeyPackages(device.id, keyPackages);

    return { message: 'Key packages uploaded successfully' };
  }

  /** Step 1 of linking a login to a device: a challenge only the holder of the device key can sign. */
  async issueSessionLinkChallenge(
    userId: string,
    deviceId: string,
    sessionId: string,
  ) {
    await this.assertOwnActiveDevice(userId, deviceId);

    // Already linked: tell the browser so it skips the signing round trip.
    const linkedDeviceId = await this.chatDevicesRepository.findSessionDeviceId(
      sessionId,
      userId,
    );
    if (linkedDeviceId === deviceId) {
      return { alreadyLinked: true as const };
    }

    return {
      challenge: issueLinkChallenge(this.linkSecret(), { sessionId, deviceId }),
    };
  }

  /** Step 2: records which device this login is in, so revoking the device ends the login; needs proof of the device key, links once. */
  async linkSessionToDevice(
    userId: string,
    deviceId: string,
    sessionId: string,
    dto: LinkSessionDto,
  ) {
    const device = await this.assertOwnActiveDevice(userId, deviceId);

    if (
      !isValidLinkChallenge(this.linkSecret(), dto.challenge, {
        sessionId,
        deviceId,
      })
    ) {
      throw new UnauthorizedException('The challenge is invalid or expired');
    }
    if (
      !isValidDeviceSignature(
        device.signaturePublicKey,
        SESSION_LINK_LABEL + dto.challenge,
        dto.signature,
      )
    ) {
      throw new ForbiddenException('The signature does not match this device');
    }

    const linked = await this.chatDevicesRepository.linkSession(
      sessionId,
      userId,
      deviceId,
    );
    if (linked.count === 0) {
      const current = await this.chatDevicesRepository.findSessionDeviceId(
        sessionId,
        userId,
      );
      if (current === null) {
        throw new NotFoundException('Session not found');
      }
      if (current !== deviceId) {
        const currentDevice =
          await this.chatDevicesRepository.findById(current);

        // A login whose linked device is retired or gone may relink to a live one.
        if (currentDevice && !currentDevice.revokedAt) {
          throw new ConflictException(
            'This login is already linked to another device',
          );
        }

        const relinked = await this.chatDevicesRepository.relinkSession(
          sessionId,
          userId,
          deviceId,
          current,
        );
        if (relinked.count === 0) {
          throw new ConflictException(
            'This login is already linked to another device',
          );
        }
      }
    }

    return { message: 'Session linked to device' };
  }

  private linkSecret(): string {
    if (!env.betterAuthSecret) {
      throw new InternalServerErrorException('BETTER_AUTH_SECRET is missing');
    }
    return env.betterAuthSecret;
  }

  /** Idempotent: revoking an already revoked device of the caller succeeds, and its logins are ended either way. */
  async revokeDevice(
    userId: string,
    deviceId: string,
    callerSessionId: string,
  ) {
    const device = await this.chatDevicesRepository.findById(deviceId);
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Device not found');
    }

    if (!device.revokedAt) {
      await this.chatDevicesRepository.revokeDevice(deviceId, userId);
    }

    const logins = await this.chatDevicesRepository.findLoginsOfDevice(
      deviceId,
      userId,
      callerSessionId,
    );
    await this.sessionTerminator.end(logins);

    return { message: 'Device revoked successfully' };
  }

  /** How many key packages other members can still claim for the caller's device, and when its reusable fallback lapses. */
  async getKeyPackageStatus(userId: string, deviceId: string) {
    await this.assertOwnActiveDevice(userId, deviceId);

    const [singleUseRemaining, lastResort] = await Promise.all([
      this.chatDevicesRepository.countClaimableSingleUseKeyPackages(deviceId),
      this.chatDevicesRepository.findLastResortKeyPackage(deviceId),
    ]);

    return {
      singleUseRemaining,
      lastResortExpiresAt: lastResort?.expiresAt.toISOString() ?? null,
    };
  }

  /** Signs a device out: its logins end at once; the device, keys and group places are untouched. */
  async signOutDevice(
    userId: string,
    deviceId: string,
    callerSessionId: string,
  ) {
    const device = await this.chatDevicesRepository.findById(deviceId);
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Device not found');
    }

    const logins = await this.chatDevicesRepository.findLoginsOfDevice(
      deviceId,
      userId,
      callerSessionId,
    );
    await this.sessionTerminator.end(logins);

    return { message: 'Device signed out' };
  }

  /** Claims one key package per active device of targetUserId (SINGLE_USE first, else LAST_RESORT; devices with neither are skipped), for messaging them or finishing a group change; excludeDeviceId and deviceIds narrow the devices. */
  async claimKeyPackagesForUser(
    requesterId: string,
    targetUserId: string,
    options: {
      excludeDeviceId?: string;
      conversationId?: string;
      /** Claim only for these devices, so a device registered meanwhile is not claimed and wasted. */
      deviceIds?: string[];
    } = {},
  ) {
    this.fetchRateLimiter.assertNotRateLimited(requesterId, targetUserId);

    const isOwnDevices = requesterId === targetUserId;
    const { excludeDeviceId, conversationId, deviceIds } = options;

    const devicesInGroup = conversationId
      ? await this.assertMayClaimForGroup(
          requesterId,
          targetUserId,
          conversationId,
        )
      : new Set<string>();

    if (!isOwnDevices && !conversationId) {
      await this.assertMayFetchKeyPackage(requesterId, targetUserId);
    }

    const devices = (
      await this.chatDevicesRepository.findActiveDevicesForUser(targetUserId)
    ).filter(
      (device) =>
        device.id !== excludeDeviceId &&
        !devicesInGroup.has(device.id) &&
        (!deviceIds || deviceIds.includes(device.id)),
    );

    if (devices.length > 1) {
      this.fetchRateLimiter.assertNotRateLimited(
        requesterId,
        targetUserId,
        devices.length - 1,
      );
    }

    const claims = await Promise.all(
      devices.map((device) => this.claimForDevice(device, requesterId)),
    );
    const offers = claims.filter((offer) => offer !== null);

    // Own or group claims may be empty; someone else's account with nothing to claim is not messageable yet.
    if (offers.length === 0 && !isOwnDevices && !conversationId) {
      throw new NotFoundException(
        'This user has no available devices to message yet',
      );
    }

    return offers;
  }

  /** Returns the devices already in the group, which a claim must skip. */
  private async assertMayClaimForGroup(
    requesterId: string,
    targetUserId: string,
    conversationId: string,
  ): Promise<Set<string>> {
    const states = await this.participantStates.findStates(conversationId, [
      requesterId,
      targetUserId,
    ]);

    if (states.get(requesterId) !== 'ACTIVE') {
      throw new ForbiddenException(
        'You are not an active member of this group',
      );
    }

    const targetState = states.get(targetUserId);

    if (!isEntitledToLeaf(targetState)) {
      throw new ForbiddenException(
        'This user is not entitled to join this group',
      );
    }

    // PENDING consent may be stale (long-lived invite); recheck only member-independent gates - FOLLOWERS was checked against the real inviter at invite time.
    if (targetState === 'PENDING') {
      await this.assertPendingInviteeStillConsents(requesterId, targetUserId);
    }

    if (!(await this.mlsGroupRosterRepository.hasRoster(conversationId))) {
      throw new ForbiddenException('This conversation has no MLS group yet');
    }

    const leaves =
      await this.mlsGroupRosterRepository.findActiveLeaves(conversationId);

    return new Set(leaves.map((leaf) => leaf.deviceId));
  }

  private async claimForDevice(
    device: {
      id: string;
      ciphersuite: string;
      signaturePublicKey: Uint8Array;
    },
    requesterId: string,
  ) {
    const keyPackage =
      (await this.chatDevicesRepository.claimSingleUseKeyPackage(
        device.id,
        requesterId,
      )) ??
      (await this.chatDevicesRepository.findLastResortKeyPackage(device.id));

    if (!keyPackage) {
      return null;
    }

    return {
      deviceId: device.id,
      ciphersuite: device.ciphersuite,
      signaturePublicKey: Buffer.from(device.signaturePublicKey).toString(
        'base64',
      ),
      payload: Buffer.from(keyPackage.payload).toString('base64'),
    };
  }

  /** The member-independent part of the consent gate: a claimant's follow relation says nothing about the invitee's consent. */
  private async assertPendingInviteeStillConsents(
    requesterId: string,
    targetUserId: string,
  ) {
    if (!(await this.pendingInviteeConsents(requesterId, targetUserId))) {
      throw new ForbiddenException('This user cannot be added to the group');
    }
  }

  private async pendingInviteeConsents(
    requesterId: string,
    targetUserId: string,
  ): Promise<boolean> {
    const [requesterBlockedTarget, targetBlockedRequester] = await Promise.all([
      this.blocksService.isBlocked(requesterId, targetUserId),
      this.blocksService.isBlocked(targetUserId, requesterId),
    ]);
    if (requesterBlockedTarget || targetBlockedRequester) {
      return false;
    }

    const target =
      await this.chatDevicesRepository.findUserMessagingProfile(targetUserId);

    return target !== null && target.messageRequestSetting !== 'NO_ONE';
  }

  /** Of these PENDING invitees, the ones the requester may not claim key packages for (see assertMayClaimForGroup). */
  async findInviteesRefusingRequester(
    requesterId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    const consents = await Promise.all(
      userIds.map((userId) => this.pendingInviteeConsents(requesterId, userId)),
    );

    return new Set(userIds.filter((_, index) => !consents[index]));
  }

  private async assertTargetAcceptsMessages(targetUserId: string) {
    const target =
      await this.chatDevicesRepository.findUserMessagingProfile(targetUserId);
    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (target.messageRequestSetting === 'NO_ONE') {
      throw new ForbiddenException(
        `User ${targetUserId} is not accepting new messages`,
      );
    }

    return target;
  }

  private async assertMayFetchKeyPackage(
    requesterId: string,
    targetUserId: string,
  ) {
    // Asymmetric: only the requester's own block stops them, not being blocked by the target.
    const requesterBlockedTarget = await this.blocksService.isBlocked(
      requesterId,
      targetUserId,
    );
    if (requesterBlockedTarget) {
      throw new ForbiddenException('You have blocked this user');
    }

    const target = await this.assertTargetAcceptsMessages(targetUserId);

    if (target.messageRequestSetting === 'FOLLOWERS') {
      const targetFollowsRequester = await this.followsService.isFollowing(
        targetUserId,
        requesterId,
      );
      if (!targetFollowsRequester.following) {
        throw new ForbiddenException(
          `User ${targetUserId} only accepts messages from people they follow`,
        );
      }
    }
  }

  /** Asserts the caller owns this active device. */
  async assertOwnActiveDevice(userId: string, deviceId: string) {
    const device = await this.chatDevicesRepository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new DeviceNotFoundException();
    }
    if (device.revokedAt) {
      throw new DeviceRevokedException();
    }

    // Keeps "stale device" meaningful (cap eviction, dormant retirement) at one write per device per hour.
    const lastSeenAt = device.lastSeenAt?.getTime() ?? Date.now();
    if (lastSeenAt < Date.now() - LAST_SEEN_WRITE_THROTTLE_MS) {
      void Promise.resolve(
        this.chatDevicesRepository.touchLastSeen(deviceId),
      ).catch(() => undefined);
    }

    return device;
  }

  /** Confirms this login is linked to a device that is still owned and active; the gate for message sends. */
  async assertSessionLinkedToActiveDevice(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    const deviceId = await this.chatDevicesRepository.findSessionDeviceId(
      sessionId,
      userId,
    );

    if (!deviceId) {
      throw new SessionNotLinkedException();
    }

    await this.assertOwnActiveDevice(userId, deviceId);
    return deviceId;
  }

  private async verifyKeyPackages(
    userId: string,
    deviceId: string,
    signaturePublicKey: Uint8Array,
    items: KeyPackageItemDto[],
  ): Promise<NewKeyPackage[]> {
    return Promise.all(
      items.map(async (item) => {
        const payloadBytes = new Uint8Array(
          Buffer.from(item.payload, 'base64'),
        );
        const keyPackage = await decodeAndVerifyKeyPackage(payloadBytes, {
          userId,
          deviceId,
          signaturePublicKey,
        });

        return {
          kind: item.kind,
          payload: payloadBytes,
          expiresAt: new Date(
            Number(keyPackage.leafNode.lifetime.notAfter) * 1000,
          ),
        };
      }),
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
