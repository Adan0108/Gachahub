jest.mock('../auth/session-terminator.service', () => ({
  SessionTerminator: class {},
}));

import { generateKeyPairSync, sign } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { env } from '../config/env';
import { ChatDevicesService } from './chat-devices.service';
import { issueLinkChallenge, SESSION_LINK_LABEL } from './session-link-proof';
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
    countActiveDevices: jest.fn(),
    touchLastSeen: jest.fn(),
    findLeastRecentlySeenActiveDevice: jest.fn(),
    findLoginsOfDevice: jest.fn(),
    linkSession: jest.fn(),
    findSessionDeviceId: jest.fn(),
    findParticipantStates: jest.fn(),
  };

  const roster = { findActiveLeaves: jest.fn(), hasRoster: jest.fn() };

  const sessionTerminator = { end: jest.fn() };

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
    repository.countActiveDevices.mockResolvedValue(0);
    repository.findLeastRecentlySeenActiveDevice.mockResolvedValue(null);
    service = new ChatDevicesService(
      repository as any,
      followsService as any,
      blocksService as any,
      fetchRateLimiter as any,
      uploadRateLimiter as any,
      roster as any,
      sessionTerminator as any,
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
          { excludeDeviceId: 'laptop' },
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
          service.claimKeyPackagesForUser('user-1', 'user-1', {
            excludeDeviceId: 'laptop',
          }),
        ).resolves.toEqual([]);
      });
    });
  });

  describe('claimKeyPackagesForUser for a change to a group', () => {
    const device = (id: string) => ({
      id,
      ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
      signaturePublicKey: Buffer.from(`sig-${id}`),
    });

    const claimForGroup = () =>
      service.claimKeyPackagesForUser('user-1', 'user-2', {
        conversationId: 'conv-1',
      });

    beforeEach(() => {
      repository.findParticipantStates.mockResolvedValue(
        new Map([
          ['user-1', 'ACTIVE'],
          ['user-2', 'JOINING'],
        ]),
      );
      roster.hasRoster.mockResolvedValue(true);
      roster.findActiveLeaves.mockResolvedValue([]);
      repository.findActiveDevicesForUser.mockResolvedValue([device('d2')]);
      repository.claimSingleUseKeyPackage.mockResolvedValue({
        payload: Buffer.from('kp'),
      });
    });

    it('lets a member claim for someone whose privacy settings would refuse a stranger - they are already authorized to be in the group', async () => {
      repository.findUserMessagingProfile.mockResolvedValue({
        id: 'user-2',
        messageRequestSetting: 'NO_ONE',
      });

      await expect(claimForGroup()).resolves.toEqual([
        expect.objectContaining({ deviceId: 'd2' }),
      ]);

      expect(repository.findUserMessagingProfile).not.toHaveBeenCalled();
      expect(blocksService.isBlocked).not.toHaveBeenCalled();
    });

    it('still applies the direct-message gates when no conversation is given', async () => {
      repository.findUserMessagingProfile.mockResolvedValue({
        id: 'user-2',
        messageRequestSetting: 'NO_ONE',
      });

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a caller who is not an ACTIVE member of the group', async () => {
      repository.findParticipantStates.mockResolvedValue(
        new Map([
          ['user-1', 'PENDING'],
          ['user-2', 'JOINING'],
        ]),
      );

      await expect(claimForGroup()).rejects.toThrow(ForbiddenException);

      expect(repository.claimSingleUseKeyPackage).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'DECLINED', 'LEAVING', 'MISSING'])(
      'refuses to claim for someone who is %s in the group',
      async (state) => {
        repository.findParticipantStates.mockResolvedValue(
          new Map(
            state === 'MISSING'
              ? [['user-1', 'ACTIVE']]
              : [
                  ['user-1', 'ACTIVE'],
                  ['user-2', state],
                ],
          ),
        );

        await expect(claimForGroup()).rejects.toThrow(ForbiddenException);
      },
    );

    it('claims only for devices not already in the group, so no package is burned on a device that cannot be added', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('d2-in'),
        device('d2-new'),
      ]);
      roster.findActiveLeaves.mockResolvedValue([
        { userId: 'user-2', deviceId: 'd2-in' },
      ]);

      const result = await claimForGroup();

      expect(result.map((offer) => offer.deviceId)).toEqual(['d2-new']);
      expect(repository.claimSingleUseKeyPackage).not.toHaveBeenCalledWith(
        'd2-in',
        expect.anything(),
      );
    });

    it('refuses a claim for a conversation that has no MLS group, so a plain group cannot be used to burn packages', async () => {
      roster.hasRoster.mockResolvedValue(false);

      await expect(claimForGroup()).rejects.toThrow(ForbiddenException);
      expect(repository.claimSingleUseKeyPackage).not.toHaveBeenCalled();
    });

    it('claims only for the devices the caller listed, so a device registered meanwhile is left alone', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('d2'),
        device('d2-late'),
      ]);

      const result = await service.claimKeyPackagesForUser('user-1', 'user-2', {
        conversationId: 'conv-1',
        deviceIds: ['d2'],
      });

      expect(result.map((offer) => offer.deviceId)).toEqual(['d2']);
      expect(repository.claimSingleUseKeyPackage).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list, not a 404, when everything is already in the group', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { userId: 'user-2', deviceId: 'd2' },
      ]);

      await expect(claimForGroup()).resolves.toEqual([]);
    });
  });

  describe('claiming charges the rate limit by packages handed out', () => {
    const device = (id: string) => ({
      id,
      ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
      signaturePublicKey: Buffer.from(`sig-${id}`),
    });

    beforeEach(() => {
      repository.findUserMessagingProfile.mockResolvedValue({
        id: 'user-2',
        messageRequestSetting: 'EVERYONE',
      });
      repository.claimSingleUseKeyPackage.mockResolvedValue({
        payload: Buffer.from('kp'),
      });
    });

    it('charges once for a one-device claim', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([device('d1')]);

      await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(fetchRateLimiter.assertNotRateLimited).toHaveBeenCalledTimes(1);
    });

    it('charges for every extra device, so claiming across many devices drains no faster than claiming one by one', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('d1'),
        device('d2'),
        device('d3'),
      ]);

      await service.claimKeyPackagesForUser('user-1', 'user-2');

      expect(fetchRateLimiter.assertNotRateLimited).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'user-2',
        2,
      );
    });

    it('claims nothing if the extra charge is refused', async () => {
      repository.findActiveDevicesForUser.mockResolvedValue([
        device('d1'),
        device('d2'),
      ]);
      fetchRateLimiter.assertNotRateLimited
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new RateLimitedException('slow down', 30);
        });

      await expect(
        service.claimKeyPackagesForUser('user-1', 'user-2'),
      ).rejects.toThrow(RateLimitedException);

      expect(repository.claimSingleUseKeyPackage).not.toHaveBeenCalled();
    });
  });

  describe('the device cap', () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    it('quietly retires the stalest device when the cap is hit and that device has been idle for weeks', async () => {
      repository.findById.mockResolvedValue(null);
      repository.countActiveDevices.mockResolvedValue(10);
      repository.findLeastRecentlySeenActiveDevice.mockResolvedValue({
        id: 'zombie-device',
        lastSeenAt: daysAgo(30),
      });
      repository.createDeviceWithKeyPackages.mockResolvedValue({
        id: 'device-11',
      });
      const { payload, signaturePublicKey } = await base64KeyPackage(
        'user-1',
        'device-11',
      );

      await service.registerDevice('user-1', {
        deviceId: 'device-11',
        signaturePublicKey,
        ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        keyPackages: [{ kind: 'SINGLE_USE', payload }],
      } as never);

      expect(repository.revokeDevice).toHaveBeenCalledWith(
        'zombie-device',
        'user-1',
      );
      expect(repository.createDeviceWithKeyPackages).toHaveBeenCalled();
    });

    it('refuses the 11th device while all ten were used recently, retiring nothing', async () => {
      repository.findById.mockResolvedValue(null);
      repository.countActiveDevices.mockResolvedValue(10);
      repository.findLeastRecentlySeenActiveDevice.mockResolvedValue({
        id: 'busy-device',
        lastSeenAt: daysAgo(1),
      });

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-11',
          signaturePublicKey: 'aaaa',
          ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
          keyPackages: [],
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.revokeDevice).not.toHaveBeenCalled();
    });

    it('refuses an 11th active device, so group snapshots stay small enough to publish', async () => {
      repository.findById.mockResolvedValue(null);
      repository.countActiveDevices.mockResolvedValue(10);

      await expect(
        service.registerDevice('user-1', {
          deviceId: 'device-11',
          signaturePublicKey: 'aaaa',
          ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
          keyPackages: [],
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.createDeviceWithKeyPackages).not.toHaveBeenCalled();
    });
  });

  describe('linking a login to a device', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawKey = new Uint8Array(
      publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    );
    const secret = 'test-secret';
    const originalSecret = env.betterAuthSecret;
    const ownDevice = {
      id: 'device-1',
      userId: 'user-1',
      revokedAt: null,
      signaturePublicKey: rawKey,
    };
    const challengeFor = (sessionId = 'session-1', deviceId = 'device-1') =>
      issueLinkChallenge(secret, { sessionId, deviceId });
    const proof = (challenge: string) => ({
      challenge,
      signature: sign(
        null,
        Buffer.from(SESSION_LINK_LABEL + challenge),
        privateKey,
      ).toString('base64'),
    });

    beforeEach(() => {
      env.betterAuthSecret = secret;
      repository.findById.mockResolvedValue(ownDevice);
      repository.findSessionDeviceId.mockResolvedValue(null);
      repository.linkSession.mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
      env.betterAuthSecret = originalSecret;
    });

    it('issues a challenge only for a device the caller owns', async () => {
      await expect(
        service.issueSessionLinkChallenge('user-1', 'device-1', 'session-1'),
      ).resolves.toEqual({ challenge: expect.any(String) as string });

      repository.findById.mockResolvedValue({ ...ownDevice, userId: 'user-2' });
      await expect(
        service.issueSessionLinkChallenge('user-1', 'device-1', 'session-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers alreadyLinked instead of a challenge when this login is linked to this device', async () => {
      repository.findSessionDeviceId.mockResolvedValue('device-1');

      await expect(
        service.issueSessionLinkChallenge('user-1', 'device-1', 'session-1'),
      ).resolves.toEqual({ alreadyLinked: true });
    });

    it('links the login when the challenge is signed with the device key', async () => {
      await service.linkSessionToDevice(
        'user-1',
        'device-1',
        'session-1',
        proof(challengeFor()),
      );

      expect(repository.linkSession).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        'device-1',
      );
    });

    it('refuses a stolen login that only knows the device id: a signature from another key', async () => {
      const attacker = generateKeyPairSync('ed25519').privateKey;
      const challenge = challengeFor();

      await expect(
        service.linkSessionToDevice('user-1', 'device-1', 'session-1', {
          challenge,
          signature: sign(null, Buffer.from(challenge), attacker).toString(
            'base64',
          ),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.linkSession).not.toHaveBeenCalled();
    });

    it('refuses a challenge made for another login', async () => {
      await expect(
        service.linkSessionToDevice(
          'user-1',
          'device-1',
          'session-1',
          proof(challengeFor('session-other')),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts linking again to the same device, but not moving to another', async () => {
      repository.linkSession.mockResolvedValue({ count: 0 });

      repository.findSessionDeviceId.mockResolvedValue('device-1');
      await expect(
        service.linkSessionToDevice(
          'user-1',
          'device-1',
          'session-1',
          proof(challengeFor()),
        ),
      ).resolves.toBeDefined();

      repository.findSessionDeviceId.mockResolvedValue('device-other');
      await expect(
        service.linkSessionToDevice(
          'user-1',
          'device-1',
          'session-1',
          proof(challengeFor()),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revokeDevice', () => {
    it('retires an owned device without touching any login', async () => {
      repository.revokeDevice.mockResolvedValue({ count: 1 });

      await expect(service.revokeDevice('user-1', 'device-1')).resolves.toEqual(
        { message: 'Device revoked successfully' },
      );
      expect(sessionTerminator.end).not.toHaveBeenCalled();
    });

    it('throws when nothing matched', async () => {
      repository.revokeDevice.mockResolvedValue({ count: 0 });

      await expect(service.revokeDevice('user-1', 'device-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('signOutDevice', () => {
    it('ends the logins of an owned device and nothing else', async () => {
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
      });
      repository.findLoginsOfDevice.mockResolvedValue([
        { id: 's2', token: 't2' },
      ]);

      await service.signOutDevice('user-1', 'device-1', 'session-1');

      expect(repository.findLoginsOfDevice).toHaveBeenCalledWith(
        'device-1',
        'user-1',
        'session-1',
      );
      expect(sessionTerminator.end).toHaveBeenCalledWith([
        { id: 's2', token: 't2' },
      ]);
      expect(repository.revokeDevice).not.toHaveBeenCalled();
    });

    it('refuses a device that belongs to someone else', async () => {
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-2',
      });

      await expect(
        service.signOutDevice('user-1', 'device-1', 'session-1'),
      ).rejects.toThrow(NotFoundException);
      expect(sessionTerminator.end).not.toHaveBeenCalled();
    });
  });

  describe('assertSessionLinkedToActiveDevice', () => {
    it('refuses a login that has never been linked to a device', async () => {
      repository.findSessionDeviceId.mockResolvedValue(null);

      await expect(
        service.assertSessionLinkedToActiveDevice('user-1', 'session-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('refuses a login linked to a revoked device', async () => {
      repository.findSessionDeviceId.mockResolvedValue('device-1');
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
        revokedAt: new Date(),
      });

      await expect(
        service.assertSessionLinkedToActiveDevice('user-1', 'session-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('resolves the device id for a login linked to an active device', async () => {
      repository.findSessionDeviceId.mockResolvedValue('device-1');
      repository.findById.mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
        revokedAt: null,
        lastSeenAt: new Date(),
      });

      await expect(
        service.assertSessionLinkedToActiveDevice('user-1', 'session-1'),
      ).resolves.toBe('device-1');
      expect(repository.findSessionDeviceId).toHaveBeenCalledWith(
        'session-1',
        'user-1',
      );
    });
  });
});
