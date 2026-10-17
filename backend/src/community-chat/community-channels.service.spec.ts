import { BadRequestException } from '@nestjs/common';
import { CommunityChannelsService } from './community-channels.service';
import { channel, scope } from './community-chat.fixtures';

describe('CommunityChannelsService', () => {
  const repository = {
    listChannels: jest.fn(),
    findReadStates: jest.fn(),
    lastMessageAtByChannel: jest.fn(),
    countUnread: jest.fn(),
    findCursor: jest.fn(),
    findReadState: jest.fn(),
    markRead: jest.fn(),
  };
  const access = { scope: jest.fn(), channelIn: jest.fn() };

  let service: CommunityChannelsService;

  beforeEach(() => {
    jest.resetAllMocks();
    access.scope.mockResolvedValue(scope());
    access.channelIn.mockResolvedValue(channel);
    repository.listChannels.mockResolvedValue([channel]);
    repository.findReadStates.mockResolvedValue([]);
    repository.lastMessageAtByChannel.mockResolvedValue([]);
    repository.countUnread.mockResolvedValue(0);
    repository.findReadState.mockResolvedValue(null);
    service = new CommunityChannelsService(
      repository as never,
      access as never,
    );
  });

  describe('listChannels', () => {
    it('lists the rooms with their unread count', async () => {
      repository.countUnread.mockResolvedValue(4);
      repository.lastMessageAtByChannel.mockResolvedValue([
        { channelId: 'c1', lastMessageAt: new Date('2026-10-16T09:00:00Z') },
      ]);

      const { channels, isMember, canModerate } = await service.listChannels(
        'wuwa',
        'me',
      );

      expect(isMember).toBe(true);
      expect(canModerate).toBe(false);
      expect(channels).toEqual([
        expect.objectContaining({
          id: 'c1',
          name: 'general',
          unreadCount: 4,
          unreadCapped: false,
          lastMessageAt: '2026-10-16T09:00:00.000Z',
        }),
      ]);
    });

    it('tells a moderator who has not joined that they are not a member', async () => {
      access.scope.mockResolvedValue(
        scope({ membership: null, canModerate: true }),
      );

      expect(await service.listChannels('wuwa', 'me')).toMatchObject({
        canModerate: true,
        isMember: false,
      });
    });

    it('counts from when you joined if you have never read the room', async () => {
      await service.listChannels('wuwa', 'me');

      expect(repository.countUnread).toHaveBeenCalledWith(
        expect.objectContaining({ since: new Date('2026-10-02T00:00:00Z') }),
      );
    });

    it('counts from where you last read', async () => {
      repository.findReadStates.mockResolvedValue([
        { channelId: 'c1', lastReadAt: new Date('2026-10-15T00:00:00Z') },
      ]);

      await service.listChannels('wuwa', 'me');

      expect(repository.countUnread).toHaveBeenCalledWith(
        expect.objectContaining({ since: new Date('2026-10-15T00:00:00Z') }),
      );
    });

    it('looks up read positions and latest times once for all rooms, not once per room', async () => {
      const second = { ...channel, id: 'c2', slug: 'trading', name: 'trading' };
      repository.listChannels.mockResolvedValue([channel, second]);
      repository.findReadStates.mockResolvedValue([
        { channelId: 'c2', lastReadAt: new Date('2026-10-14T00:00:00Z') },
      ]);
      repository.lastMessageAtByChannel.mockResolvedValue([
        { channelId: 'c1', lastMessageAt: new Date('2026-10-16T09:00:00Z') },
      ]);

      const { channels } = await service.listChannels('wuwa', 'me');

      expect(repository.findReadStates).toHaveBeenCalledTimes(1);
      expect(repository.findReadStates).toHaveBeenCalledWith('me', [
        'c1',
        'c2',
      ]);
      expect(repository.lastMessageAtByChannel).toHaveBeenCalledTimes(1);
      expect(repository.lastMessageAtByChannel).toHaveBeenCalledWith([
        'c1',
        'c2',
      ]);
      expect(channels.map((item) => item.lastMessageAt)).toEqual([
        '2026-10-16T09:00:00.000Z',
        null,
      ]);
      // each room counts from its own position: one has been read, the other has not
      expect(repository.countUnread).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'c2',
          since: new Date('2026-10-14T00:00:00Z'),
        }),
      );
      expect(repository.countUnread).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'c1',
          since: new Date('2026-10-02T00:00:00Z'),
        }),
      );
    });

    it('stops counting at 99 and says it was cut', async () => {
      repository.countUnread.mockResolvedValue(100);

      const { channels } = await service.listChannels('wuwa', 'me');

      expect(channels[0]).toMatchObject({
        unreadCount: 99,
        unreadCapped: true,
      });
    });
  });

  describe('markRead', () => {
    const markRead = (messageId?: string) =>
      service.markRead('wuwa', 'c1', { messageId }, 'me');

    it('marks the room read as of now', async () => {
      const before = Date.now();

      await markRead();

      const [{ at }] = repository.markRead.mock.calls[0] as [{ at: Date }];
      expect(at.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('marks it read as of the message you saw, so newer ones stay unread', async () => {
      const seenAt = new Date('2026-10-16T08:00:00Z');
      repository.findCursor.mockResolvedValue({ id: 'm9', createdAt: seenAt });

      await markRead('m9');

      expect(repository.markRead).toHaveBeenCalledWith({
        userId: 'me',
        channelId: 'c1',
        at: seenAt,
        messageId: 'm9',
      });
    });

    it('never moves backwards', async () => {
      repository.findCursor.mockResolvedValue({
        id: 'm1',
        createdAt: new Date('2026-10-10T00:00:00Z'),
      });
      repository.findReadState.mockResolvedValue({
        lastReadAt: new Date('2026-10-15T00:00:00Z'),
      });

      await markRead('m1');

      expect(repository.markRead).not.toHaveBeenCalled();
    });

    it('refuses a message that is not in this room', async () => {
      repository.findCursor.mockResolvedValue(null);

      await expect(markRead('nope')).rejects.toThrow(BadRequestException);
    });
  });
});
