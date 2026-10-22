import { BadRequestException } from '@nestjs/common';
import { CommunityMentionsService } from './community-mentions.service';
import { game, scope } from './community-chat.fixtures';

describe('CommunityMentionsService', () => {
  const repository = {
    findMemberIdsByUsernames: jest.fn(),
    searchMembers: jest.fn(),
  };
  const access = { scope: jest.fn() };
  const mentions = { resolveTargets: jest.fn(), publishMentions: jest.fn() };
  let service: CommunityMentionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    access.scope.mockResolvedValue(scope());
    repository.findMemberIdsByUsernames.mockResolvedValue(new Set(['bobby']));
    mentions.resolveTargets.mockResolvedValue(['bobby']);
    service = new CommunityMentionsService(
      repository as never,
      access as never,
      mentions as never,
    );
  });

  describe('targetsFor', () => {
    it('asks nothing when the text names nobody', async () => {
      await expect(
        service.targetsFor('g1', 'me', 'hello there'),
      ).resolves.toEqual([]);

      expect(repository.findMemberIdsByUsernames).not.toHaveBeenCalled();
      expect(mentions.resolveTargets).not.toHaveBeenCalled();
    });

    it('looks the handles up among this community only, and lets in members only', async () => {
      const targets = await service.targetsFor(
        'g1',
        'me',
        'hi @bobby and @carol',
      );

      expect(repository.findMemberIdsByUsernames).toHaveBeenCalledWith('g1', [
        'bobby',
        'carol',
      ]);
      expect(targets).toEqual(['bobby']);
      const { canView, actorId, text } = (
        mentions.resolveTargets.mock.calls[0] as unknown[]
      )[0] as {
        canView: (id: string) => Promise<boolean>;
        actorId: string;
        text: string;
      };
      expect(actorId).toBe('me');
      expect(text).toBe('hi @bobby and @carol');
      await expect(canView('bobby')).resolves.toBe(true);
      await expect(canView('outsider')).resolves.toBe(false);
    });

    it('allows exactly the limit of people', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => `@user${i}`).join(' ');

      await expect(service.targetsFor('g1', 'me', ten)).resolves.toBeDefined();
    });

    it('refuses a message that mentions more than the limit, before looking anyone up', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `@user${i}`).join(
        ' ',
      );

      await expect(service.targetsFor('g1', 'me', eleven)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.findMemberIdsByUsernames).not.toHaveBeenCalled();
    });

    it('counts one person once, however often they are named', async () => {
      const repeated = Array.from({ length: 15 }, () => '@bobby').join(' ');

      await expect(
        service.targetsFor('g1', 'me', repeated),
      ).resolves.toBeDefined();
    });
  });

  describe('publish', () => {
    it('queues the pings for the saved message as community message mentions', async () => {
      const tx = {} as never;

      await service.publish(tx, {
        targetIds: ['bo'],
        actorId: 'me',
        messageId: 'm1',
      });

      expect(mentions.publishMentions).toHaveBeenCalledWith(
        {
          targetIds: ['bo'],
          actorId: 'me',
          entityType: 'COMMUNITY_MESSAGE',
          entityId: 'm1',
        },
        tx,
      );
    });
  });

  describe('searchMembers', () => {
    it('suggests members of this community for what was typed after the @, without the @', async () => {
      repository.searchMembers.mockResolvedValue([
        { id: 'bo', name: 'Bo', username: 'bo', image: null },
      ]);

      const result = await service.searchMembers('wuwa', ' @bo ', 'me');

      expect(access.scope).toHaveBeenCalledWith('wuwa', 'me');
      expect(repository.searchMembers).toHaveBeenCalledWith({
        gameId: game.id,
        viewerId: 'me',
        query: 'bo',
        limit: 8,
      });
      expect(result.items).toHaveLength(1);
    });

    it('refuses someone who cannot use this chat', async () => {
      access.scope.mockRejectedValue(new Error('Join this community'));

      await expect(service.searchMembers('wuwa', 'b', 'me')).rejects.toThrow(
        'Join this community',
      );
      expect(repository.searchMembers).not.toHaveBeenCalled();
    });
  });
});
