import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlocksService } from '../blocks/blocks.service';
import { isEntitledToLeaf } from '../chat/membership/leaf-entitlement';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
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
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UploadKeyPackagesDto } from './dto/upload-key-packages.dto';
import { KeyPackageItemDto } from './dto/key-package-item.dto';

@Injectable()
export class ChatDevicesService {
  constructor(
    private readonly chatDevicesRepository: ChatDevicesRepository,
    private readonly followsService: FollowsService,
    private readonly blocksService: BlocksService,
    private readonly fetchRateLimiter: KeyPackageFetchRateLimiterService,
    private readonly uploadRateLimiter: KeyPackageUploadRateLimiterService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  /**
   * Registers a new device for the current user. Not idempotent by design
   * (matches DeviceIdentityStore.provision() on the frontend) - calling
   * this with a deviceId that already exists is always a conflict, never a
   * silent no-op, since the caller only calls it once per fresh identity.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    this.uploadRateLimiter.assertNotRateLimited(userId);

    // Every key package is already checked against PINNED_CIPHERSUITE
    // individually (decodeAndVerifyKeyPackage) - this closes the gap where
    // the device's own DECLARED ciphersuite could disagree with that, which
    // would defeat the whole point of pinning one (critique C1).
    if (dto.ciphersuite !== PINNED_CIPHERSUITE) {
      throw new BadRequestException(
        `Unsupported ciphersuite: expected ${PINNED_CIPHERSUITE}`,
      );
    }

    const existing = await this.chatDevicesRepository.findById(dto.deviceId);
    if (existing) {
      throw new ConflictException('This device id is already registered');
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

    return this.chatDevicesRepository.createDeviceWithKeyPackages({
      deviceId: dto.deviceId,
      userId,
      signaturePublicKey,
      ciphersuite: dto.ciphersuite,
      keyPackages,
    });
  }

  /**
   * Tops up more key packages for a device the caller already owns.
   */
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

  async revokeDevice(userId: string, deviceId: string) {
    const result = await this.chatDevicesRepository.revokeDevice(
      deviceId,
      userId,
    );

    if (result.count === 0) {
      throw new NotFoundException('Device not found');
    }

    return { message: 'Device revoked successfully' };
  }

  /**
   * Claims one key package for EACH of targetUserId's active devices, for
   * the caller to add them all to an MLS group in a single commit - MLS
   * membership is per device, so adding only one would leave the user's
   * other devices unable to read the conversation. Per device, prefers a
   * SINGLE_USE package and falls back to that device's LAST_RESORT one
   * (never consumed) only when it has no single-use package left. A device
   * with no usable package is skipped rather than failing the whole claim.
   *
   * Pass excludeDeviceId when claiming the caller's OWN devices, to leave
   * out the device that is creating the group (already a member).
   *
   * Two ways to be allowed, because there are two different reasons to claim:
   * - Messaging someone (no conversationId): the same gates as chat's
   *   assertMessageRequestAllowed - a block by the requester, and the target's
   *   messageRequestSetting. Skipped when claiming your own devices.
   * - Finishing a change to a group you are in (conversationId): the person is
   *   already authorized to be in that group, so their DM privacy settings no
   *   longer apply - they would otherwise leave someone stuck JOINING for good,
   *   refused for every member. The caller must be an ACTIVE participant and
   *   the target entitled to be in it. Devices already in the group are left
   *   out, so a claim only ever burns packages that will actually be used.
   */
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

    // The request above counted once; every extra package handed out counts too.
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

    // Own devices and devices for a group can legitimately be none (nothing new
    // to add); someone else's account with nothing to claim means they can't be
    // messaged yet.
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
    const states = await this.chatDevicesRepository.findParticipantStates(
      conversationId,
      [requesterId, targetUserId],
    );

    if (states.get(requesterId) !== 'ACTIVE') {
      throw new ForbiddenException(
        'You are not an active member of this group',
      );
    }

    if (!isEntitledToLeaf(states.get(targetUserId))) {
      throw new ForbiddenException(
        'This user is not entitled to join this group',
      );
    }

    // A group with no MLS roster has nothing to finish, and no key package of
    // anyone's is ever needed for it.
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

  private async assertMayFetchKeyPackage(
    requesterId: string,
    targetUserId: string,
  ) {
    // Asymmetric, matching chat.service.ts's assertSenderHasNotBlockedRecipient:
    // the requester's own block stops them, but being blocked BY the target
    // doesn't - a blocked-by party can still message today (silently), so it
    // must still be able to provision a device to encrypt that message with.
    const requesterBlockedTarget = await this.blocksService.isBlocked(
      requesterId,
      targetUserId,
    );
    if (requesterBlockedTarget) {
      throw new ForbiddenException('You have blocked this user');
    }

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

  /**
   * Public: stage 4 (MlsHandshakesService) reuses this exact ownership
   * check rather than re-implementing it - a device submitting a handshake
   * or fetching Welcomes has to pass the same "do you own this active
   * device" test as uploading key packages does.
   */
  async assertOwnActiveDevice(userId: string, deviceId: string) {
    const device = await this.chatDevicesRepository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new NotFoundException('Device not found');
    }
    if (device.revokedAt) {
      throw new ConflictException('This device has been revoked');
    }

    return device;
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
