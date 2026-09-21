import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatDevicesService } from './chat-devices.service';
import { buildTestKeyPackage } from './test-support/build-key-package';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

describe('ChatDevicesService', () => {
  const repository = {
    findById: jest.fn(),
    findUserMessagingProfile: jest.fn(),
    createDeviceWithKeyPackages: jest.fn(),
    addKeyPackages: jest.fn(),
    findActiveDevicesForUser: jest.fn(),
    claimSingleUseKeyPackage: jest.fn(),
    findLastResortKeyPackage: jest.fn(),
    revokeDevice: jest.fn(),
  };

  const followsService = {
    isFollowing: jest.fn(),
  };

  const blocksService = {
    isBlocked: jest.fn(),
  };

  const fetchRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  const uploadRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  let service: ChatDevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    blocksService.isBlocked.mockResolvedValue(false);
    service = new ChatDevicesService(
      repository as any,
      followsService as any,
      blocksService as any,
      fetchRateLimiter as any,
      uploadRateLimiter as any,
    );
  });

  async function base64KeyPackage(userId: string, deviceId: string) {
    const built = await buildTestKeyPackage(userId, deviceId);
    return {
      payload: Buffer.from(built.payload).toString('base64'),
      signaturePublicKey: Buffer.from(built.signaturePublicKey).toString(
        'base64',
      ),
    };
  }

  describe('registerDevice', () => {
    it('creates a device with its verified key packages', async () => {
      repository.findById.mockResolvedValue(null);
      repository.createDeviceWithKeyPackages.mockResolvedValue({
        id: 'device-1',
      });
      const { payload, signaturePublicKey } = await base64KeyPackage(
        'user-1',
        'device-1',
      );

      await service.registerDevice('user-1', {
        deviceId: 'device-1',
        signaturePublicKey,
        ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        keyPackages: [{ kind: 'SINGLE_USE', payload }],
      } as any);

      expect(repository.createDeviceWithKeyPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-1',
          userId: 'user-1',
          keyPackages: [expect.objectContaining({ kind: 'SINGLE_USE' })],
        }),
      );
    });

    it('rejects when the device id is already registered', async () => {
      repository.findById.mockResolvedValue({ id: 'device-1' });
      const { payload, signaturePublicKey } = await base64KeyPackage(
        'user-1',
        'device-1',
      );

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-1',
          signaturePublicKey,
          ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
          keyPackages: [{ kind: 'SINGLE_USE', payload }],
        } as any),
      ).rejects.toThrow(ConflictException);

      expect(repository.createDeviceWithKeyPackages).not.toHaveBeenCalled();
    });

    it('rejects a key package whose credential belongs to a different device', async () => {
      repository.findById.mockResolvedValue(null);
      const { payload, signaturePublicKey } = await base64KeyPackage(
        'user-1',
        'some-other-device',
      );

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-1',
          signaturePublicKey,
          ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
          keyPackages: [{ kind: 'SINGLE_USE', payload }],
        } as any),
      ).rejects.toThrow(
        'Key package credential does not match the authenticated user/device',
      );

      expect(repository.createDeviceWithKeyPackages).not.toHaveBeenCalled();
    });

    it('rejects a declared ciphersuite that is not the pinned one', async () => {
      repository.findById.mockResolvedValue(null);
      const { payload, signaturePublicKey } = await base64KeyPackage(
        'user-1',
        'device-1',
      );

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-1',
          signaturePublicKey,
          ciphersuite: 'something-else-entirely',
          keyPackages: [{ kind: 'SINGLE_USE', payload }],
        } as any),
      ).rejects.toThrow(/Unsupported ciphersuite/);

      expect(repository.createDeviceWithKeyPackages).not.toHaveBeenCalled();
    });

    it('enforces the upload rate limit', async () => {
      uploadRateLimiter.assertNotRateLimited.mockImplementationOnce(() => {
        throw new RateLimitedException('slow down', 30);
      });

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-1',
          signaturePublicKey: Buffer.from('sig-key').toString('base64'),
          ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
          keyPackages: [],
        } as any),
      ).rejects.toThrow(RateLimitedException);

      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe('uploadKeyPackages', () => {
    it('adds key packages to a device the caller owns', async () => {
      const built = await buildTestKeyPackage('user-1', 'device-1');
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
        revokedAt: null,
        signaturePublicKey: Buffer.from(built.signaturePublicKey),
      });

      await service.uploadKeyPackages('user-1', 'device-1', {
        keyPackages: [
          {
            kind: 'SINGLE_USE',
            payload: Buffer.from(built.payload).toString('base64'),
          },
        ],
      } as any);

      expect(repository.addKeyPackages).toHaveBeenCalledWith(
        'device-1',
        expect.arrayContaining([
          expect.objectContaining({ kind: 'SINGLE_USE' }),
        ]),
      );
    });

    it('rejects a device that belongs to someone else', async () => {
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'someone-else',
        revokedAt: null,
      });

      await expect(
        service.uploadKeyPackages('user-1', 'device-1', {
          keyPackages: [],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a revoked device', async () => {
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
        revokedAt: new Date(),
      });

      await expect(
        service.uploadKeyPackages('user-1', 'device-1', {
          keyPackages: [],
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('enforces the upload rate limit', async () => {
      uploadRateLimiter.assertNotRateLimited.mockImplementationOnce(() => {
        throw new RateLimitedException('slow down', 30);
      });

      await expect(
        service.uploadKeyPackages('user-1', 'device-1', {
          keyPackages: [],
        } as any),
      ).rejects.toThrow(RateLimitedException);

      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe('claimKeyPackagesForUser', () => {
    const activeTarget = { id: 'user-2', messageRequestSetting: 'EVERYONE' };
    const ciphersuite = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

    const device = (id: string) => ({
      id,
      ciphersuite,
      signaturePublicKey: Buffer.from(`sig-${id}`),
    });

    beforeEach(() => {
      repository.findUserMessagingProfile.mockResolvedValue(activeTarget);
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('device-2'),
      ]);
      repository.claimSingleUseKeyPackage.mockResolvedValue({
        payload: Buffer.from('key-package-bytes'),
      });
      repository.findLastResortKeyPackage.mockResolvedValue(null);
    });

    it('enforces the fetch rate limit', async () => {
      fetchRateLimiter.assertNotRateLimited.mockImplementationOnce(() => {
        throw new RateLimitedException('slow down', 30);
      });

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(RateLimitedException);
    });

    it('rejects when the requester has blocked the target', async () => {
      blocksService.isBlocked.mockImplementation(
        (blockerId: string, blockedId: string) =>
          Promise.resolve(blockerId === 'user-1' && blockedId === 'user-2'),
      );

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not reject when the target has blocked the requester (asymmetric, matches chat.service.ts)', async () => {
      blocksService.isBlocked.mockImplementation(
        (blockerId: string, blockedId: string) =>
          Promise.resolve(blockerId === 'user-2' && blockedId === 'user-1'),
      );

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).resolves.toEqual([expect.objectContaining({ deviceId: 'device-2' })]);
    });

    it('rejects when the target user does not exist', async () => {
      repository.findUserMessagingProfile.mockResolvedValue(null);

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the target accepts no new messages', async () => {
      repository.findUserMessagingProfile.mockResolvedValue({
        id: 'user-2',
        messageRequestSetting: 'NO_ONE',
      });

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the target only accepts messages from followers and does not follow back', async () => {
      repository.findUserMessagingProfile.mockResolvedValue({
        id: 'user-2',
        messageRequestSetting: 'FOLLOWERS',
      });
      followsService.isFollowing.mockResolvedValue({ following: false });

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('claims a single-use key package for the device when one is available', async () => {
      const result = await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(repository.claimSingleUseKeyPackage).toHaveBeenCalledWith(
        'device-2',
        'user-1',
      );
      expect(repository.findLastResortKeyPackage).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          deviceId: 'device-2',
          ciphersuite,
          signaturePublicKey: Buffer.from('sig-device-2').toString('base64'),
          payload: Buffer.from('key-package-bytes').toString('base64'),
        },
      ]);
    });

    it('claims one key package for EACH active device, so every device can be added to the group', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('device-a'),
        device('device-b'),
      ]);

      const result = await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(result.map((offer) => offer.deviceId)).toEqual([
        'device-a',
        'device-b',
      ]);
      expect(repository.claimSingleUseKeyPackage).toHaveBeenCalledWith(
        'device-a',
        'user-1',
      );
      expect(repository.claimSingleUseKeyPackage).toHaveBeenCalledWith(
        'device-b',
        'user-1',
      );
    });

    it("falls back to a device's last-resort key package when it has no single-use one", async () => {
      repository.claimSingleUseKeyPackage.mockResolvedValue(null);
      repository.findLastResortKeyPackage.mockResolvedValue({
        payload: Buffer.from('last-resort-bytes'),
      });

      const result = await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(repository.findLastResortKeyPackage).toHaveBeenCalledWith(
        'device-2',
      );
      expect(result[0]?.payload).toBe(
        Buffer.from('last-resort-bytes').toString('base64'),
      );
    });

    it('skips a device with no usable key package instead of failing the whole claim', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('device-a'),
        device('device-b'),
      ]);
      repository.claimSingleUseKeyPackage.mockImplementation(
        (deviceId: string) =>
          Promise.resolve(
            deviceId === 'device-a' ? null : { payload: Buffer.from('bytes') },
          ),
      );

      const result = await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(result.map((offer) => offer.deviceId)).toEqual(['device-b']);
    });

    it('throws when the target has no claimable devices at all', async () => {
      repository.claimSingleUseKeyPackage.mockResolvedValue(null);
      repository.findLastResortKeyPackage.mockResolvedValue(null);

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(NotFoundException);
    });

    describe("claiming the requester's own devices", () => {
      it('skips the block and messaging-setting gates', async () => {
        repository.findActiveDevicesForUser.mockResolvedValue([
          device('phone'),
        ]);

        await service.claimKeyPackagesForUser('user-1', 'user-1');

        expect(blocksService.isBlocked).not.toHaveBeenCalled();
        expect(repository.findUserMessagingProfile).not.toHaveBeenCalled();
      });

      it('leaves out the excluded device (the one creating the group)', async () => {
        repository.findActiveDevicesForUser.mockResolvedValue([
          device('laptop'),
          device('phone'),
        ]);

        const result = await service.claimKeyPackagesForUser(
          'user-1',
          'user-1',
          'laptop',
        );

        expect(result.map((offer) => offer.deviceId)).toEqual(['phone']);
        expect(repository.claimSingleUseKeyPackage).not.toHaveBeenCalledWith(
          'laptop',
          expect.anything(),
        );
      });

      it('returns an empty list, not a 404, when there are no other devices', async () => {
        repository.findActiveDevicesForUser.mockResolvedValue([
          device('laptop'),
        ]);

        await expect(
          service.claimKeyPackagesForUser('user-1', 'user-1', 'laptop'),
        ).resolves.toEqual([]);
      });
    });
  });

  describe('revokeDevice', () => {
    it('revokes an owned device', async () => {
      repository.revokeDevice.mockResolvedValue({ count: 1 });

      const result = await service.revokeDevice('user-1', 'device-1');

      expect(result).toEqual({ message: 'Device revoked successfully' });
    });

    it('throws when nothing matched', async () => {
      repository.revokeDevice.mockResolvedValue({ count: 0 });

      await expect(service.revokeDevice('user-1', 'device-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
