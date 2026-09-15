import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlocksService } from '../blocks/blocks.service';
import { FollowsService } from '../follows/follows.service';
import {
  ChatDevicesRepository,
  type NewKeyPackage,
} from './chat-devices.repository';
import { KeyPackageFetchRateLimiterService } from './key-package-fetch-rate-limiter.service';
import { KeyPackageUploadRateLimiterService } from './key-package-upload-rate-limiter.service';
import { decodeAndVerifyKeyPackage } from './mls-key-package.util';
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
  ) {}

  /**
   * Registers a new device for the current user. Not idempotent by design
   * (matches DeviceIdentityStore.provision() on the frontend) - calling
   * this with a deviceId that already exists is always a conflict, never a
   * silent no-op, since the caller only calls it once per fresh identity.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    this.uploadRateLimiter.assertNotRateLimited(userId);

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
   * Claims one key package for targetUserId, for the caller to use in
   * adding a device to an MLS group. Prefers a SINGLE_USE package,
   * falling back to the LAST_RESORT one (never consumed) only when no
   * single-use package is available.
   *
   * Same authorization shape as chat's assertMessageRequestAllowed
   * (mutual-block check, messageRequestSetting gate) - duplicated here
   * rather than shared, since stage 5 (MLS-driven membership) will need to
   * reconcile this against "already in a shared group" exceptions chat.
   * service.ts's version doesn't need to consider. Unify then, not now.
   */
  async claimKeyPackageForUser(requesterId: string, targetUserId: string) {
    this.fetchRateLimiter.assertNotRateLimited(requesterId, targetUserId);

    await this.assertMayFetchKeyPackage(requesterId, targetUserId);

    const claimed = await this.chatDevicesRepository.claimSingleUseKeyPackage(
      targetUserId,
      requesterId,
    );

    const keyPackage =
      claimed ??
      (await this.chatDevicesRepository.findLastResortKeyPackage(targetUserId));

    if (!keyPackage) {
      throw new NotFoundException(
        'This user has no available devices to message yet',
      );
    }

    const device = await this.chatDevicesRepository.findById(
      keyPackage.deviceId,
    );
    if (!device) {
      throw new NotFoundException(
        'This user has no available devices to message yet',
      );
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

  private async assertOwnActiveDevice(userId: string, deviceId: string) {
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
