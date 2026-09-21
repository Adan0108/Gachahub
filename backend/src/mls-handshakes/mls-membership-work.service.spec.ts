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
    findUnrevokedDevicesOfUsers: jest.fn(),
  };
  const chatDevicesService = { assertOwnActiveDevice: jest.fn() };

  let service: MlsMembershipWorkService;

  const conversation = (id: string, joiningUserId?: string) => ({
    id,
    mlsEpoch: 2,
    participants: joiningUserId
      ? [{ userId: joiningUserId, state: 'JOINING' }]
      : [{ userId: 'leaver', state: 'LEAVING' }],
    activeLeaves: [
      { userId: 'me', deviceId: 'my-device' },
      { userId: 'leaver', deviceId: 'leaver-device' },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    repository.findConversationsNeedingWork.mockResolvedValue([]);
    repository.findUnrevokedDevicesOfUsers.mockResolvedValue([]);

    service = new MlsMembershipWorkService(
      repository as unknown as MlsMembershipWorkRepository,
      chatDevicesService as unknown as ChatDevicesService,
    );
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

  it('asks for conversations this device and user can commit in, from the cursor', async () => {
    await service.getMembershipWork('user-1', 'device-1', {
      after: 'conv-9',
    });

    expect(repository.findConversationsNeedingWork).toHaveBeenCalledWith({
      deviceId: 'device-1',
      userId: 'user-1',
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

  it('turns a leaving member into devices to remove, without looking up any devices', async () => {
    repository.findConversationsNeedingWork.mockResolvedValue([
      conversation('conv-1'),
    ]);

    const result = await service.getMembershipWork('user-1', 'device-1');

    expect(result.items).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        remove: [{ userId: 'leaver', deviceId: 'leaver-device' }],
      }),
    ]);
    expect(repository.findUnrevokedDevicesOfUsers).not.toHaveBeenCalled();
  });

  it('looks up devices once for everyone waiting to join, across conversations', async () => {
    repository.findConversationsNeedingWork.mockResolvedValue([
      conversation('conv-1', 'joiner'),
      conversation('conv-2', 'joiner'),
    ]);
    repository.findUnrevokedDevicesOfUsers.mockResolvedValue([
      { userId: 'joiner', deviceId: 'joiner-device' },
    ]);

    const result = await service.getMembershipWork('user-1', 'device-1');

    expect(repository.findUnrevokedDevicesOfUsers).toHaveBeenCalledTimes(1);
    expect(repository.findUnrevokedDevicesOfUsers).toHaveBeenCalledWith([
      'joiner',
    ]);
    expect(result.items.map((item) => item.add)).toEqual([
      [{ userId: 'joiner', deviceId: 'joiner-device' }],
      [{ userId: 'joiner', deviceId: 'joiner-device' }],
    ]);
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
      // conv-* with a joiner nobody can reach produce no item but still fill the page
      const page = Array.from({ length: 50 }, (_, i) =>
        conversation(`conv-${String(i).padStart(2, '0')}`, 'unreachable'),
      );
      repository.findConversationsNeedingWork.mockResolvedValue(page);

      const result = await service.getMembershipWork('user-1', 'device-1');

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBe('conv-49');
    });
  });
});
