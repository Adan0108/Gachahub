jest.mock('../auth/session-terminator.service', () => ({
  SessionTerminator: class {},
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { MlsHandshakesService } from './mls-handshakes.service';
import { buildTestCommitWithWelcome } from './test-support/build-test-commit';
import { buildTestExternalJoin } from './test-support/build-test-external-join';

describe('MlsHandshakesService', () => {
  const repository = {
    isActiveParticipant: jest.fn(),
    isEntitledParticipant: jest.fn(),
    acceptHandshake: jest.fn(),
    acceptExternalJoin: jest.fn(),
    findHandshakesSince: jest.fn(),
    findRosterAtEpoch: jest.fn(),
    findPendingWelcomes: jest.fn(),
    markWelcomeConsumed: jest.fn(),
  };

  const chatDevicesService = {
    assertOwnActiveDevice: jest.fn(),
  };

  const selfJoinRateLimiter = { assertMayJoin: jest.fn() };

  let service: MlsHandshakesService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.isActiveParticipant.mockResolvedValue(true);
    repository.isEntitledParticipant.mockResolvedValue(true);
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      revokedAt: null,
    });
    service = new MlsHandshakesService(
      repository as any,
      chatDevicesService as any,
      selfJoinRateLimiter as any,
    );
  });

  describe('submitHandshake', () => {
    it('accepts a real commit and passes its sha256 through to the repository', async () => {
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');
      repository.acceptHandshake.mockResolvedValue({
        outcome: 'accepted',
        handshake: {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch,
          senderDeviceId: 'device-1',
          payload: commitPayload,
          createdAt: new Date(),
        },
      });

      const result = await service.submitHandshake('user-1', 'conv-1', {
        deviceId: 'device-1',
        epoch,
        payload: Buffer.from(commitPayload).toString('base64'),
        welcomes: [],
        addedDeviceIds: [],
        removedDeviceIds: [],
      });

      expect(result.outcome).toBe('accepted');
      expect(repository.acceptHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          expectedEpoch: epoch,
          senderDeviceId: 'device-1',
          payloadSha256: createHash('sha256')
            .update(commitPayload)
            .digest('hex'),
        }),
      );
    });

    it('returns the declaration with the accepted handshake and with the winning one on a lost race', async () => {
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');
      const handshake = {
        id: 'hs-1',
        conversationId: 'conv-1',
        epoch,
        senderDeviceId: 'device-2',
        payload: commitPayload,
        membershipDeclared: true,
        addedDevices: [{ deviceId: 'device-4' }],
        removedDevices: [],
        createdAt: new Date(),
      };
      const dto = {
        deviceId: 'device-1',
        epoch,
        payload: Buffer.from(commitPayload).toString('base64'),
        welcomes: [],
        addedDeviceIds: [],
        removedDeviceIds: [],
      };

      repository.acceptHandshake.mockResolvedValue({
        outcome: 'accepted',
        handshake,
      });
      await expect(
        service.submitHandshake('user-1', 'conv-1', dto),
      ).resolves.toMatchObject({
        handshake: {
          membershipDeclared: true,
          addedDevices: [{ deviceId: 'device-4' }],
        },
      });

      repository.acceptHandshake.mockResolvedValue({
        outcome: 'conflict',
        handshake,
      });
      await expect(
        service.submitHandshake('user-1', 'conv-1', dto),
      ).rejects.toMatchObject({
        response: {
          handshake: {
            membershipDeclared: true,
            addedDevices: [{ deviceId: 'device-4' }],
          },
        },
      });
    });

    it('forwards real Welcome bytes for newly added devices', async () => {
      const { epoch, commitPayload, welcomePayload } =
        await buildTestCommitWithWelcome('conv-1');
      repository.acceptHandshake.mockResolvedValue({
        outcome: 'accepted',
        handshake: {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch,
          senderDeviceId: 'device-1',
          payload: commitPayload,
          createdAt: new Date(),
        },
      });

      await service.submitHandshake('user-1', 'conv-1', {
        deviceId: 'device-1',
        epoch,
        payload: Buffer.from(commitPayload).toString('base64'),
        welcomes: [
          {
            recipientDeviceId: 'device-2',
            payload: Buffer.from(welcomePayload).toString('base64'),
          },
        ],
        addedDeviceIds: ['device-2'],
        removedDeviceIds: [],
      });

      expect(repository.acceptHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          welcomes: [
            expect.objectContaining({ recipientDeviceId: 'device-2' }),
          ],
        }),
      );
    });

    it('passes the sender, and what the Commit declares it adds and removes, to the repository', async () => {
      const { epoch, commitPayload, welcomePayload } =
        await buildTestCommitWithWelcome('conv-1');
      repository.acceptHandshake.mockResolvedValue({
        outcome: 'accepted',
        handshake: {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch,
          senderDeviceId: 'device-1',
          payload: commitPayload,
          createdAt: new Date(),
        },
      });

      await service.submitHandshake('user-1', 'conv-1', {
        deviceId: 'device-1',
        epoch,
        payload: Buffer.from(commitPayload).toString('base64'),
        welcomes: [
          {
            recipientDeviceId: 'device-2',
            payload: Buffer.from(welcomePayload).toString('base64'),
          },
        ],
        addedDeviceIds: ['device-2'],
        removedDeviceIds: ['device-3'],
      });

      expect(repository.acceptHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          senderUserId: 'user-1',
          addedDeviceIds: ['device-2'],
          removedDeviceIds: ['device-3'],
        }),
      );
    });

    it('rejects a declaration that does not add up before ever reaching the repository', async () => {
      const { epoch, commitPayload, welcomePayload } =
        await buildTestCommitWithWelcome('conv-1');

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          // a Welcome for a device the Commit does not declare as added
          welcomes: [
            {
              recipientDeviceId: 'device-2',
              payload: Buffer.from(welcomePayload).toString('base64'),
            },
          ],
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow('exactly the devices');

      expect(repository.acceptHandshake).not.toHaveBeenCalled();
    });

    it('rejects a commit addressed to a different conversation before ever reaching the repository', async () => {
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');

      await expect(
        service.submitHandshake('user-1', 'conv-2', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          welcomes: [],
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow('group_id does not match this conversation');

      expect(repository.acceptHandshake).not.toHaveBeenCalled();
    });

    it('throws a ConflictException carrying the winning handshake on a lost race', async () => {
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');
      const winnerPayload = new TextEncoder().encode('someone-elses-commit');
      repository.acceptHandshake.mockResolvedValue({
        outcome: 'conflict',
        handshake: {
          id: 'hs-winner',
          conversationId: 'conv-1',
          epoch,
          senderDeviceId: 'device-2',
          payload: winnerPayload,
          createdAt: new Date(),
        },
      });

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          welcomes: [],
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates an authorization rejection from the repository (e.g. an unauthorized welcome recipient)', async () => {
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');
      repository.acceptHandshake.mockRejectedValue(
        new ForbiddenException('User user-2 is not an active participant'),
      );

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          welcomes: [],
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the caller is not an active participant in the conversation', async () => {
      repository.isActiveParticipant.mockResolvedValue(false);
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          welcomes: [],
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
    });
  });

  describe('submitExternalJoin', () => {
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
    const registeredKey = (key: Uint8Array) => ({
      id: 'device-1',
      userId: 'user-1',
      revokedAt: null,
      signaturePublicKey: key,
    });

    it('accepts a real external commit from the callers own device, with the snapshot for the epoch it creates', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.acceptExternalJoin.mockResolvedValue({
        outcome: 'accepted',
        handshake: {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch: join.epoch,
          senderDeviceId: 'device-1',
          payload: join.commitPayload,
          membershipDeclared: true,
          addedDevices: [],
          removedDevices: [],
          createdAt: new Date(),
        },
      });

      const result = await service.submitExternalJoin('user-1', 'conv-1', {
        deviceId: 'device-1',
        epoch: join.epoch,
        payload: b64(join.commitPayload),
        groupInfo: b64(join.nextGroupInfoPayload),
      });

      expect(result.outcome).toBe('accepted');
      expect(repository.acceptExternalJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          expectedEpoch: join.epoch,
          deviceId: 'device-1',
          userId: 'user-1',
        }),
      );
    });

    it('refuses a commit that adds a leaf other than the callers registered device key', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(new Uint8Array([9, 9, 9])),
      );

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.acceptExternalJoin).not.toHaveBeenCalled();
    });

    it('refuses a commit that adds someone elses device, even with the right key', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'victim',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a snapshot for the wrong epoch', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.groupInfoPayload),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('answers a lost race with the winning commit, like any other submit', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.acceptExternalJoin.mockResolvedValue({
        outcome: 'conflict',
        handshake: {
          id: 'hs-w',
          conversationId: 'conv-1',
          epoch: join.epoch,
          senderDeviceId: 'device-9',
          payload: new Uint8Array([1]),
          membershipDeclared: true,
          addedDevices: [],
          removedDevices: [],
          createdAt: new Date(),
        },
      });

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getHandshakesSince', () => {
    it('serializes handshake payloads as base64', async () => {
      repository.findHandshakesSince.mockResolvedValue([
        {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch: 0,
          senderDeviceId: 'device-1',
          payload: new Uint8Array([1, 2, 3]),
          createdAt: new Date(),
        },
      ]);

      const result = await service.getHandshakesSince('user-1', 'conv-1', 0);

      expect(result[0].payload).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    });

    it('hands out what each Commit was declared to do, so every member can check it', async () => {
      repository.findHandshakesSince.mockResolvedValue([
        {
          id: 'hs-1',
          conversationId: 'conv-1',
          epoch: 0,
          senderDeviceId: 'device-1',
          payload: new Uint8Array([1]),
          membershipDeclared: true,
          addedDevices: [{ deviceId: 'device-2' }],
          removedDevices: [{ deviceId: 'device-3' }],
          createdAt: new Date(),
        },
      ]);

      const result = await service.getHandshakesSince('user-1', 'conv-1', 0);

      expect(result[0]).toMatchObject({
        membershipDeclared: true,
        addedDevices: [{ deviceId: 'device-2' }],
        removedDevices: [{ deviceId: 'device-3' }],
      });
    });

    it('rejects when the caller is not an active participant', async () => {
      repository.isEntitledParticipant.mockResolvedValue(false);

      await expect(
        service.getHandshakesSince('user-1', 'conv-1', 0),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getRosterAtEpoch', () => {
    it('returns each leaf with its registered key as base64, or null when the device record is gone', async () => {
      repository.findRosterAtEpoch.mockResolvedValue([
        {
          deviceId: 'd1',
          userId: 'u1',
          signaturePublicKey: new Uint8Array([1, 2]),
        },
        { deviceId: 'd2', userId: 'u2', signaturePublicKey: null },
      ]);

      await expect(
        service.getRosterAtEpoch('user-1', 'conv-1', 3),
      ).resolves.toEqual({
        epoch: 3,
        leaves: [
          {
            deviceId: 'd1',
            userId: 'u1',
            signaturePublicKey: Buffer.from([1, 2]).toString('base64'),
          },
          { deviceId: 'd2', userId: 'u2', signaturePublicKey: null },
        ],
      });
      expect(repository.findRosterAtEpoch).toHaveBeenCalledWith('conv-1', 3);
    });

    it('lets an archived or blocked member read it - their new device still has to join', async () => {
      repository.isActiveParticipant.mockResolvedValue(false);
      repository.findRosterAtEpoch.mockResolvedValue([]);

      await expect(
        service.getRosterAtEpoch('user-1', 'conv-1', 3),
      ).resolves.toEqual({ epoch: 3, leaves: [] });
    });

    it('rejects when the caller is not a member', async () => {
      repository.isEntitledParticipant.mockResolvedValue(false);

      await expect(
        service.getRosterAtEpoch('user-1', 'conv-1', 3),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findRosterAtEpoch).not.toHaveBeenCalled();
    });
  });

  describe('getPendingWelcomes', () => {
    it('checks device ownership before listing', async () => {
      repository.findPendingWelcomes.mockResolvedValue([]);

      await service.getPendingWelcomes('user-1', 'device-1');

      expect(chatDevicesService.assertOwnActiveDevice).toHaveBeenCalledWith(
        'user-1',
        'device-1',
      );
    });
  });

  describe('consumeWelcome', () => {
    it('rejects when nothing matched (wrong device or already consumed)', async () => {
      repository.markWelcomeConsumed.mockResolvedValue(false);

      await expect(
        service.consumeWelcome('user-1', 'device-1', 'welcome-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('succeeds when the update matched', async () => {
      repository.markWelcomeConsumed.mockResolvedValue(true);

      await expect(
        service.consumeWelcome('user-1', 'device-1', 'welcome-1'),
      ).resolves.toEqual({ message: 'Welcome consumed' });
    });
  });
});
