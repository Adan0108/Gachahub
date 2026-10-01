jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
}));
jest.mock('./mls-handshakes.repository', () => ({
  MlsHandshakesRepository: class {},
}));
jest.mock('./mls-self-join.repository', () => ({
  MlsSelfJoinRepository: class {},
}));
jest.mock('./mls-membership-work.repository', () => ({
  MlsMembershipWorkRepository: class {},
}));

import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { NotFoundException } from '@nestjs/common';
import { MlsPendingService } from './mls-pending.service';

describe('MlsPendingService', () => {
  const handshakesRepository = { countPendingWelcomes: jest.fn() };
  const selfJoinRepository = { findJoinableConversationIds: jest.fn() };
  const workRepository = { hasPendingWork: jest.fn() };
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

  let service: MlsPendingService;

  beforeEach(() => {
    jest.clearAllMocks();
    requestRateLimiter.assertMayPollPending.mockReset();
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    handshakesRepository.countPendingWelcomes.mockResolvedValue(0);
    selfJoinRepository.findJoinableConversationIds.mockResolvedValue([]);
    workRepository.hasPendingWork.mockResolvedValue(false);
    service = new MlsPendingService(
      handshakesRepository as never,
      selfJoinRepository as never,
      workRepository as never,
      chatDevicesService as never,
      requestRateLimiter as never,
    );
  });

  it('is rate limited per user, before any lookup', async () => {
    requestRateLimiter.assertMayPollPending.mockImplementation(
      throwRateLimited,
    );

    await expect(
      service.getPendingSummary('user-1', 'device-1'),
    ).rejects.toThrow(RateLimitedException);

    expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
  });

  it('answers all-clear in one call when nothing is waiting', async () => {
    await expect(
      service.getPendingSummary('user-1', 'device-1'),
    ).resolves.toEqual({ welcomes: 0, joinable: false, membershipWork: false });
  });

  it('says what is waiting: welcomes, groups to join, and membership work', async () => {
    handshakesRepository.countPendingWelcomes.mockResolvedValue(2);
    selfJoinRepository.findJoinableConversationIds.mockResolvedValue([
      'conv-1',
    ]);
    workRepository.hasPendingWork.mockResolvedValue(true);

    await expect(
      service.getPendingSummary('user-1', 'device-1'),
    ).resolves.toEqual({ welcomes: 2, joinable: true, membershipWork: true });
  });

  it('only answers for a device the caller owns', async () => {
    chatDevicesService.assertOwnActiveDevice.mockRejectedValue(
      new NotFoundException('Device not found'),
    );

    await expect(
      service.getPendingSummary('user-1', 'device-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
