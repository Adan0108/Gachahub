import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { MlsHandshakesService } from './mls-handshakes.service';
import { buildTestCommitWithWelcome } from './test-support/build-test-commit';

describe('MlsHandshakesService', () => {
  const repository = {
    isActiveParticipant: jest.fn(),
    acceptHandshake: jest.fn(),
    findHandshakesSince: jest.fn(),
    findPendingWelcomes: jest.fn(),
    markWelcomeConsumed: jest.fn(),
  };

  const chatDevicesService = {
    assertOwnActiveDevice: jest.fn(),
    deviceExists: jest.fn(),
  };

  let service: MlsHandshakesService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.isActiveParticipant.mockResolvedValue(true);
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      revokedAt: null,
    });
    chatDevicesService.deviceExists.mockResolvedValue(true);
    service = new MlsHandshakesService(
      repository as any,
      chatDevicesService as any,
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
      });

      expect(repository.acceptHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          welcomes: [
            expect.objectContaining({ recipientDeviceId: 'device-2' }),
          ],
        }),
      );
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
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a welcome addressed to a device that does not exist, before reaching the repository', async () => {
      const { epoch, commitPayload, welcomePayload } =
        await buildTestCommitWithWelcome('conv-1');
      chatDevicesService.deviceExists.mockResolvedValue(false);

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
          welcomes: [
            {
              recipientDeviceId: 'no-such-device',
              payload: Buffer.from(welcomePayload).toString('base64'),
            },
          ],
        }),
      ).rejects.toThrow('Unknown recipient device');

      expect(repository.acceptHandshake).not.toHaveBeenCalled();
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
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
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

    it('rejects when the caller is not an active participant', async () => {
      repository.isActiveParticipant.mockResolvedValue(false);

      await expect(
        service.getHandshakesSince('user-1', 'conv-1', 0),
      ).rejects.toThrow(ForbiddenException);
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
