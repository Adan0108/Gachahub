jest.mock('../auth/session-terminator.service', () => ({
  SessionTerminator: class {},
}));

import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  HANDSHAKES_PER_PAGE,
  MlsHandshakesService,
  WELCOMES_PER_PAGE,
} from './mls-handshakes.service';
import { decodeMlsMessage, encodeMlsMessage } from 'ts-mls';
import * as groupInfoUtil from './mls-group-info.util';
import { buildTestCommitWithWelcome } from './test-support/build-test-commit';
import { buildTestExternalJoin } from './test-support/build-test-external-join';

describe('MlsHandshakesService', () => {
  const participantStates = { findState: jest.fn() };
  const repository = {
    acceptHandshake: jest.fn(),
    acceptExternalJoin: jest.fn(),
    getCurrentEpoch: jest.fn(),
    findHandshakesSince: jest.fn(),
    findRosterAtEpoch: jest.fn(),
    findPendingWelcomes: jest.fn(),
    markWelcomeConsumed: jest.fn(),
  };

  const chatDevicesService = {
    assertOwnActiveDevice: jest.fn(),
  };

  const requestRateLimiter = {
    assertMaySubmitHandshake: jest.fn(),
    assertMayTakeMembershipWork: jest.fn(),
    assertMayPollPending: jest.fn(),
    assertMayFetchRoster: jest.fn(),
  };
  const throwRateLimited = () => {
    throw new RateLimitedException('slow down', 30);
  };

  const selfJoinRateLimiter = { assertMayJoin: jest.fn() };

  const groupInfos = { findCurrent: jest.fn() };

  let service: MlsHandshakesService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(requestRateLimiter).forEach((fn) => fn.mockReset());
    groupInfos.findCurrent.mockResolvedValue(null);
    participantStates.findState.mockResolvedValue('ACTIVE');
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      revokedAt: null,
    });
    service = new MlsHandshakesService(
      repository as any,
      chatDevicesService as any,
      selfJoinRateLimiter as any,
      groupInfos as any,
      requestRateLimiter as any,
      participantStates as any,
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

    it('fans the one Welcome out to a row per added device', async () => {
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
        welcome: {
          recipientDeviceIds: ['device-2', 'device-3'],
          payload: Buffer.from(welcomePayload).toString('base64'),
        },
        addedDeviceIds: ['device-2', 'device-3'],
        removedDeviceIds: [],
      });

      expect(repository.acceptHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          welcomes: [
            { recipientDeviceId: 'device-2', payload: welcomePayload },
            { recipientDeviceId: 'device-3', payload: welcomePayload },
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
        welcome: {
          recipientDeviceIds: ['device-2'],
          payload: Buffer.from(welcomePayload).toString('base64'),
        },
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
          welcome: {
            recipientDeviceIds: ['device-2'],
            payload: Buffer.from(welcomePayload).toString('base64'),
          },
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
          addedDeviceIds: [],
          removedDeviceIds: [],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the caller is not an active participant in the conversation', async () => {
      participantStates.findState.mockResolvedValue('PENDING');
      const { epoch, commitPayload } =
        await buildTestCommitWithWelcome('conv-1');

      await expect(
        service.submitHandshake('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch,
          payload: Buffer.from(commitPayload).toString('base64'),
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
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });
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

    it('still accepts the commit but stores no snapshot when it is not signed by the callers device', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      const stranger = await buildTestExternalJoin('conv-1', {
        userId: 'user-9',
        deviceId: 'device-9',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });
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

      await service.submitExternalJoin('user-1', 'conv-1', {
        deviceId: 'device-1',
        epoch: join.epoch,
        payload: b64(join.commitPayload),
        groupInfo: b64(stranger.nextGroupInfoPayload),
      });

      expect(repository.acceptExternalJoin).toHaveBeenCalledWith(
        expect.objectContaining({ groupInfo: undefined }),
      );
    });

    it('refuses a commit whose signature is forged, even with the right identity and public key in the leaf', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });
      // a stolen login knows the public key but not the private one: garbage signature
      const decoded = decodeMlsMessage(join.commitPayload, 0)![0];
      if (decoded.wireformat !== 'mls_public_message') throw new Error('x');
      decoded.publicMessage.auth.signature =
        decoded.publicMessage.auth.signature.map((byte) => byte ^ 0xff);
      const forged = encodeMlsMessage(decoded);

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(forged),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.acceptExternalJoin).not.toHaveBeenCalled();
    });

    it('refuses a join when the server has no snapshot for that epoch any more', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue(null);

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(ConflictException);
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
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });

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
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });

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
      repository.getCurrentEpoch.mockResolvedValue(join.epoch);
      groupInfos.findCurrent.mockResolvedValue({
        epoch: join.epoch,
        payload: join.groupInfoPayload,
      });
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

    it.each([
      ['a non-participant', undefined],
      ['a removed member', 'LEAVING' as const],
      ['someone who declined', 'DECLINED' as const],
    ])(
      'refuses %s with 403 before revealing anything about the epoch',
      async (_label, state) => {
        const join = await buildTestExternalJoin('conv-1', {
          userId: 'user-1',
          deviceId: 'device-1',
        });
        participantStates.findState.mockResolvedValue(state);
        repository.getCurrentEpoch.mockResolvedValue(join.epoch + 5);

        const attempt = service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
        });

        await expect(attempt).rejects.toThrow(ForbiddenException);
        const error = (await attempt.catch(
          (e: unknown) => e,
        )) as ForbiddenException;
        expect(JSON.stringify(error.getResponse())).not.toContain('handshake');
        expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
        expect(repository.getCurrentEpoch).not.toHaveBeenCalled();
        expect(repository.acceptExternalJoin).not.toHaveBeenCalled();
      },
    );

    it('rethrows an unexpected error while checking the snapshot instead of swallowing it', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.getCurrentEpoch.mockResolvedValue(join.epoch + 1);
      const spy = jest
        .spyOn(groupInfoUtil, 'assertGroupInfoSignedBy')
        .mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow('boom');
      expect(repository.acceptExternalJoin).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('refuses a join for a conversation that does not exist', async () => {
      const join = await buildTestExternalJoin('conv-1', {
        userId: 'user-1',
        deviceId: 'device-1',
      });
      chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
        registeredKey(join.joinerSignatureKey),
      );
      repository.getCurrentEpoch.mockResolvedValue(null);

      await expect(
        service.submitExternalJoin('user-1', 'conv-1', {
          deviceId: 'device-1',
          epoch: join.epoch,
          payload: b64(join.commitPayload),
          groupInfo: b64(join.nextGroupInfoPayload),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(groupInfos.findCurrent).not.toHaveBeenCalled();
    });

    describe('resubmitting an epoch that already settled - recovering from a crash', () => {
      // resubmitting the same verified bytes tells "my own join won" from a conflict
      it('does not re-verify the signature against a live snapshot - the epoch has already moved on', async () => {
        const join = await buildTestExternalJoin('conv-1', {
          userId: 'user-1',
          deviceId: 'device-1',
        });
        chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
          registeredKey(join.joinerSignatureKey),
        );
        // the epoch this device is resubmitting for has already been decided; there is no live snapshot for it any more
        repository.getCurrentEpoch.mockResolvedValue(join.epoch + 1);
        repository.acceptExternalJoin.mockResolvedValue({
          outcome: 'duplicate',
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

        expect(result.outcome).toBe('duplicate');
        expect(groupInfos.findCurrent).not.toHaveBeenCalled();
      });

      it('reports conflict, not accepted, when a different commit is what actually won that epoch', async () => {
        const join = await buildTestExternalJoin('conv-1', {
          userId: 'user-1',
          deviceId: 'device-1',
        });
        chatDevicesService.assertOwnActiveDevice.mockResolvedValue(
          registeredKey(join.joinerSignatureKey),
        );
        repository.getCurrentEpoch.mockResolvedValue(join.epoch + 1);
        repository.acceptExternalJoin.mockResolvedValue({
          outcome: 'conflict',
          handshake: {
            id: 'hs-other',
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
      participantStates.findState.mockResolvedValue(undefined);

      await expect(
        service.getHandshakesSince('user-1', 'conv-1', 0),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('paging', () => {
    it('asks for at most one page of Commits, in epoch order', async () => {
      repository.findHandshakesSince.mockResolvedValue([]);

      await service.getHandshakesSince('user-1', 'conv-1', 5);

      expect(repository.findHandshakesSince).toHaveBeenCalledWith(
        'conv-1',
        5,
        HANDSHAKES_PER_PAGE,
      );
      expect(HANDSHAKES_PER_PAGE).toBe(100);
    });

    it('asks for at most one page of Welcomes', async () => {
      repository.findPendingWelcomes.mockResolvedValue([]);

      await service.getPendingWelcomes('user-1', 'device-1');

      expect(repository.findPendingWelcomes).toHaveBeenCalledWith(
        'device-1',
        WELCOMES_PER_PAGE,
        undefined,
      );
      expect(WELCOMES_PER_PAGE).toBe(50);
    });

    it('passes the after cursor through so a page of unconsumable Welcomes cannot starve newer ones', async () => {
      repository.findPendingWelcomes.mockResolvedValue([]);

      await service.getPendingWelcomes('user-1', 'device-1', 'w-50');

      expect(repository.findPendingWelcomes).toHaveBeenCalledWith(
        'device-1',
        WELCOMES_PER_PAGE,
        'w-50',
      );
    });
  });

  describe('getPendingWelcomes with an unknown cursor', () => {
    it('is a 400 so the client restarts deliberately instead of silently re-paging from the top', async () => {
      repository.findPendingWelcomes.mockResolvedValue(null);

      await expect(
        service.getPendingWelcomes('user-1', 'device-1', 'gone'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rate limits', () => {
    it('limits submitting a Commit before touching anything', async () => {
      requestRateLimiter.assertMaySubmitHandshake.mockImplementation(
        throwRateLimited,
      );

      await expect(
        service.submitHandshake('user-1', 'conv-1', {} as never),
      ).rejects.toThrow(RateLimitedException);
      expect(repository.acceptExternalJoin).not.toHaveBeenCalled();
    });

    it('limits consuming a Welcome', async () => {
      requestRateLimiter.assertMayPollPending.mockImplementation(
        throwRateLimited,
      );

      await expect(
        service.consumeWelcome('user-1', 'device-1', 'w1'),
      ).rejects.toThrow(RateLimitedException);
      expect(repository.markWelcomeConsumed).not.toHaveBeenCalled();
    });

    it('limits roster fetches', async () => {
      requestRateLimiter.assertMayFetchRoster.mockImplementation(
        throwRateLimited,
      );

      await expect(
        service.getRosterAtEpoch('user-1', 'conv-1', 1),
      ).rejects.toThrow(RateLimitedException);
      expect(repository.findRosterAtEpoch).not.toHaveBeenCalled();
    });

    it('limits pending Welcome polls', async () => {
      requestRateLimiter.assertMayPollPending.mockImplementation(
        throwRateLimited,
      );

      await expect(
        service.getPendingWelcomes('user-1', 'device-1'),
      ).rejects.toThrow(RateLimitedException);
      expect(repository.findPendingWelcomes).not.toHaveBeenCalled();
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
      participantStates.findState.mockResolvedValue('PENDING');
      repository.findRosterAtEpoch.mockResolvedValue([]);

      await expect(
        service.getRosterAtEpoch('user-1', 'conv-1', 3),
      ).resolves.toEqual({ epoch: 3, leaves: [] });
    });

    it('rejects when the caller is not a member', async () => {
      participantStates.findState.mockResolvedValue(undefined);

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
