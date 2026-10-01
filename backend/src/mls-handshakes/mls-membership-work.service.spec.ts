import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { ForbiddenException } from '@nestjs/common';
import type { ChatDevicesService } from '../chat-devices/chat-devices.service';
import type { MlsMembershipWorkRepository } from './mls-membership-work.repository';

jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
}));
jest.mock('./mls-membership-work.repository', () => ({
  MlsMembershipWorkRepository: class {},
}));

import { MlsMembershipWorkService } from './mls-membership-work.service';

describe('MlsMembershipWorkService', () => {
  const repository = {
    findConversationsNeedingWork: jest.fn(),
    findDevices: jest.fn(),
    leaseConversations: jest.fn(),
    releaseLease: jest.fn(),
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

  const chatDevicesService = {
    assertOwnActiveDevice: jest.fn(),
    findInviteesRefusingRequester: jest.fn(),
  };

  let service: MlsMembershipWorkService;

  const conversation = (id: string, joiningUserId?: string) => ({
    id,
    mlsEpoch: 2,
    participants: [
      { userId: 'me', state: 'ACTIVE' },
      joiningUserId
        ? { userId: joiningUserId, state: 'JOINING' }
        : { userId: 'leaver', state: 'LEAVING' },
    ],
    activeLeaves: [
      { userId: 'me', deviceId: 'device-1' },
      ...(joiningUserId
        ? []
        : [{ userId: 'leaver', deviceId: 'leaver-device' }]),
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requestRateLimiter.assertMayTakeMembershipWork.mockReset();
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    chatDevicesService.findInviteesRefusingRequester.mockResolvedValue(
      new Set(),
    );
    repository.findConversationsNeedingWork.mockResolvedValue([]);
    repository.findDevices.mockResolvedValue([]);
    repository.leaseConversations.mockImplementation(
      ({ conversationIds }: { conversationIds: string[] }) =>
        Promise.resolve(new Set(conversationIds)),
    );

    service = new MlsMembershipWorkService(
      repository as unknown as MlsMembershipWorkRepository,
      chatDevicesService as unknown as ChatDevicesService,
      requestRateLimiter as never,
    );
  });

  it('is rate limited per user, before any lookup', async () => {
    requestRateLimiter.assertMayTakeMembershipWork.mockImplementation(
      throwRateLimited,
    );

    await expect(
      service.getMembershipWork('user-1', 'device-1'),
    ).rejects.toThrow(RateLimitedException);

    expect(requestRateLimiter.assertMayTakeMembershipWork).toHaveBeenCalledWith(
      'user-1',
    );
    expect(chatDevicesService.assertOwnActiveDevice).not.toHaveBeenCalled();
  });

  it('only answers for a device the caller owns and that is still active', async () => {
    chatDevicesService.assertOwnActiveDevice.mockRejectedValue(
      new ForbiddenException('not yours'),
    );

    await expect(
      service.getMembershipWork('user-1', 'someone-elses-device'),
    ).rejects.toThrow(ForbiddenException);

    expect(repository.findConversationsNeedingWork).not.toHaveBeenCalled();
  });

  it('looks only where someone is joining or leaving unless asked to look everywhere', async () => {
    await service.getMembershipWork('user-1', 'device-1');
    await service.getMembershipWork('user-1', 'device-1', { scope: 'full' });

    expect(repository.findConversationsNeedingWork).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ scope: 'pending' }),
    );
    expect(repository.findConversationsNeedingWork).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scope: 'full' }),
    );
  });

  it('asks for conversations this device and user can commit in, from the cursor', async () => {
    await service.getMembershipWork('user-1', 'device-1', {
      after: 'conv-9',
    });

    expect(repository.findConversationsNeedingWork).toHaveBeenCalledWith({
      deviceId: 'device-1',
      userId: 'user-1',
      scope: 'pending',
      after: 'conv-9',
      conversationId: undefined,
      limit: 50,
    });
  });

  it('can be narrowed to one conversation', async () => {
    await service.getMembershipWork('user-1', 'device-1', {
      conversationId: 'conv-3',
    });

    expect(repository.findConversationsNeedingWork).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-3' }),
    );
  });

  it('asks for the devices of everyone in the conversations and every device in the groups, once', async () => {
    repository.findConversationsNeedingWork.mockResolvedValue([
      conversation('conv-1', 'joiner'),
      conversation('conv-2', 'joiner'),
    ]);

    await service.getMembershipWork('user-1', 'device-1');

    expect(repository.findDevices).toHaveBeenCalledTimes(1);
    expect(repository.findDevices).toHaveBeenCalledWith({
      userIds: ['me', 'joiner'],
      deviceIds: ['device-1'],
    });
  });

  it('turns a leaving member into devices to remove', async () => {
    repository.findConversationsNeedingWork.mockResolvedValue([
      conversation('conv-1'),
    ]);
    repository.findDevices.mockResolvedValue([
      { userId: 'me', deviceId: 'device-1', revoked: false },
      { userId: 'leaver', deviceId: 'leaver-device', revoked: false },
    ]);

    const result = await service.getMembershipWork('user-1', 'device-1');

    expect(result.items).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        remove: [{ userId: 'leaver', deviceId: 'leaver-device' }],
      }),
    ]);
  });

  it('turns a joining member into devices to add', async () => {
    repository.findConversationsNeedingWork.mockResolvedValue([
      conversation('conv-1', 'joiner'),
    ]);
    repository.findDevices.mockResolvedValue([
      { userId: 'me', deviceId: 'device-1', revoked: false },
      { userId: 'leaver', deviceId: 'leaver-device', revoked: false },
      { userId: 'joiner', deviceId: 'joiner-device', revoked: false },
    ]);

    const result = await service.getMembershipWork('user-1', 'device-1');

    expect(result.items[0]?.add).toEqual([
      { userId: 'joiner', deviceId: 'joiner-device' },
    ]);
  });

  describe('handing work to one device at a time', () => {
    const withLeaverWork = () => {
      repository.findConversationsNeedingWork.mockResolvedValue([
        conversation('conv-1'),
        conversation('conv-2'),
      ]);
      repository.findDevices.mockResolvedValue([
        { userId: 'me', deviceId: 'device-1', revoked: false },
        { userId: 'leaver', deviceId: 'leaver-device', revoked: false },
      ]);
    };

    it('leases the conversations that have work, for a minute', async () => {
      withLeaverWork();

      await service.getMembershipWork('user-1', 'device-1');

      const [args] = repository.leaseConversations.mock.calls[0] as [
        { deviceId: string; conversationIds: string[]; now: Date; until: Date },
      ];
      expect(args.deviceId).toBe('device-1');
      expect(args.conversationIds).toEqual(['conv-1', 'conv-2']);
      expect(args.until.getTime() - args.now.getTime()).toBe(60_000);
    });

    it('leaves out a conversation another device already holds', async () => {
      withLeaverWork();
      repository.leaseConversations.mockResolvedValue(new Set(['conv-2']));

      const result = await service.getMembershipWork('user-1', 'device-1');

      expect(result.items.map((item) => item.conversationId)).toEqual([
        'conv-2',
      ]);
    });

    it('does not take a lease for a conversation with nothing to do', async () => {
      repository.findConversationsNeedingWork.mockResolvedValue([
        conversation('conv-1', 'unreachable'),
      ]);

      await service.getMembershipWork('user-1', 'device-1');

      expect(repository.leaseConversations).not.toHaveBeenCalled();
    });
  });

  it('does not look up devices when there are no conversations', async () => {
    await service.getMembershipWork('user-1', 'device-1');

    expect(repository.findDevices).not.toHaveBeenCalled();
  });

  describe('paging', () => {
    it('has no next page when fewer than a full page came back', async () => {
      repository.findConversationsNeedingWork.mockResolvedValue([
        conversation('conv-1'),
      ]);

      await expect(
        service.getMembershipWork('user-1', 'device-1'),
      ).resolves.toMatchObject({ nextCursor: null });
    });

    it('points at the last conversation examined when a full page came back, even if some had no work', async () => {
      // with no device records, each joiner is unreachable: no item, but the page is full
      const page = Array.from({ length: 50 }, (_, i) =>
        conversation(`conv-${String(i).padStart(2, '0')}`, 'unreachable'),
      );
      repository.findConversationsNeedingWork.mockResolvedValue(page);

      const result = await service.getMembershipWork('user-1', 'device-1');

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBe('conv-49');
    });
  });

  describe('PENDING invitees who refuse the requester', () => {
    const pendingConversation = () => ({
      id: 'conv-1',
      mlsEpoch: 2,
      participants: [
        { userId: 'user-1', state: 'ACTIVE' },
        { userId: 'invitee', state: 'PENDING' },
      ],
      activeLeaves: [{ userId: 'user-1', deviceId: 'device-1' }],
    });

    beforeEach(() => {
      repository.findConversationsNeedingWork.mockResolvedValue([
        pendingConversation(),
      ]);
      repository.findDevices.mockResolvedValue([
        { userId: 'user-1', deviceId: 'device-1', revoked: false },
        { userId: 'invitee', deviceId: 'invitee-device', revoked: false },
      ]);
    });

    it('are asked about once per user, never including the requester', async () => {
      await service.getMembershipWork('user-1', 'device-1');

      expect(
        chatDevicesService.findInviteesRefusingRequester,
      ).toHaveBeenCalledWith('user-1', ['invitee']);
    });

    it('are left out of the work, so no one polls for an add that would be refused', async () => {
      chatDevicesService.findInviteesRefusingRequester.mockResolvedValue(
        new Set(['invitee']),
      );

      const result = await service.getMembershipWork('user-1', 'device-1');

      expect(result.items).toEqual([]);
    });

    it('still get their devices added when they consent', async () => {
      const result = await service.getMembershipWork('user-1', 'device-1');

      expect(result.items[0]?.add).toEqual([
        { userId: 'invitee', deviceId: 'invitee-device' },
      ]);
    });
  });

  describe('releaseMembershipWork', () => {
    it('gives back the lease for a device the caller owns', async () => {
      await service.releaseMembershipWork('user-1', 'device-1', 'conv-1');

      expect(chatDevicesService.assertOwnActiveDevice).toHaveBeenCalledWith(
        'user-1',
        'device-1',
      );
      expect(repository.releaseLease).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-1',
          conversationId: 'conv-1',
        }),
      );
    });
  });
});
