jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
}));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));
jest.mock('./mls-handshakes.repository', () => ({
  MlsHandshakesRepository: class {},
}));
jest.mock('./mls-group-info.repository', () => ({
  MlsGroupInfoRepository: class {},
}));
jest.mock('./mls-self-join.repository', () => ({
  MlsSelfJoinRepository: class {},
}));
jest.mock('./mls-self-join-rate-limiter.service', () => ({
  MlsSelfJoinRateLimiterService: class {},
}));

import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MlsSelfJoinService } from './mls-self-join.service';

describe('MlsSelfJoinService', () => {
  const selfJoinRepository = { findJoinableConversationIds: jest.fn() };
  const groupInfoRepository = { findCurrent: jest.fn() };
  const participantStates = { findState: jest.fn() };
  const rosterRepository = { findActiveLeaves: jest.fn() };
  const requestRateLimiter = {
    assertMaySubmitHandshake: jest.fn(),
    assertMayTakeMembershipWork: jest.fn(),
    assertMayPollPending: jest.fn(),
    assertMayFetchRoster: jest.fn(),
  };
  const throwRateLimited = () => {
    throw new RateLimitedException('slow down', 30);
  };

  const chatDevicesService = { assertOwnActiveDevice: jest.fn() };
  const rateLimiter = {
    assertMayFetchGroupInfo: jest.fn(),
    assertMayJoin: jest.fn(),
  };

  let service: MlsSelfJoinService;

  beforeEach(() => {
    jest.clearAllMocks();
    requestRateLimiter.assertMayPollPending.mockReset();
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    participantStates.findState.mockResolvedValue('ACTIVE');
    rosterRepository.findActiveLeaves.mockResolvedValue([
      { userId: 'user-2', deviceId: 'other-device' },
    ]);
    groupInfoRepository.findCurrent.mockResolvedValue({
      epoch: 4,
      payload: new Uint8Array([1, 2]),
    });
    service = new MlsSelfJoinService(
      selfJoinRepository as never,
      groupInfoRepository as never,
      participantStates as never,
      rosterRepository as never,
      chatDevicesService as never,
      rateLimiter as never,
      requestRateLimiter as never,
    );
  });

  describe('listJoinable', () => {
    it('rate limits listing joinable conversations before any lookup', async () => {
      requestRateLimiter.assertMayPollPending.mockImplementation(
        throwRateLimited,
      );

      await expect(
        service.listJoinable('user-1', 'device-1', 'pending'),
      ).rejects.toThrow(RateLimitedException);

      expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
    });

    it('lists what a device of the caller could join, after checking the device is theirs', async () => {
      selfJoinRepository.findJoinableConversationIds.mockResolvedValue([
        'conv-1',
      ]);

      await expect(
        service.listJoinable('user-1', 'device-1', 'pending'),
      ).resolves.toEqual({ conversationIds: ['conv-1'] });

      expect(chatDevicesService.assertOwnActiveDevice).toHaveBeenCalledWith(
        'user-1',
        'device-1',
      );
      expect(
        selfJoinRepository.findJoinableConversationIds,
      ).toHaveBeenCalledWith({
        userId: 'user-1',
        deviceId: 'device-1',
        scope: 'pending',
        limit: 50,
      });
    });
  });

  describe('getGroupInfo', () => {
    it('hands the current snapshot, base64, to an entitled user for a device not in the group', async () => {
      await expect(
        service.getGroupInfo('user-1', 'conv-1', 'device-1'),
      ).resolves.toEqual({
        epoch: 4,
        groupInfo: Buffer.from([1, 2]).toString('base64'),
      });
    });

    it('refuses someone who is not entitled to be in the group', async () => {
      participantStates.findState.mockResolvedValue('LEAVING');

      await expect(
        service.getGroupInfo('user-1', 'conv-1', 'device-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(groupInfoRepository.findCurrent).not.toHaveBeenCalled();
    });

    it('says so when the device is already in the group', async () => {
      rosterRepository.findActiveLeaves.mockResolvedValue([
        { userId: 'user-1', deviceId: 'device-1' },
      ]);

      await expect(
        service.getGroupInfo('user-1', 'conv-1', 'device-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('says so when there is no up-to-date snapshot yet', async () => {
      groupInfoRepository.findCurrent.mockResolvedValue(null);

      await expect(
        service.getGroupInfo('user-1', 'conv-1', 'device-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
