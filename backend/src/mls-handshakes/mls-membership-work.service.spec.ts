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
  };
  const chatDevicesService = { assertOwnActiveDevice: jest.fn() };

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
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    repository.findConversationsNeedingWork.mockResolvedValue([]);
    repository.findDevices.mockResolvedValue([]);

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
});
