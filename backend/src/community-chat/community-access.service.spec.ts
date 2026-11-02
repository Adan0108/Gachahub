import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CommunityAccessService } from './community-access.service';
import { channel, game, row } from './community-chat.fixtures';

describe('CommunityAccessService', () => {
  const repository = {
    findGameBySlug: jest.fn(),
    findMembership: jest.fn(),
    findChannel: jest.fn(),
    findMessageInGame: jest.fn(),
  };
  const prisma = { user: { findUnique: jest.fn() } };
  const moderators = { findByGameIdAndUserId: jest.fn() };

  let access: CommunityAccessService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'me',
      role: 'USER',
      status: 'ACTIVE',
    });
    repository.findGameBySlug.mockResolvedValue(game);
    repository.findMembership.mockResolvedValue({
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    moderators.findByGameIdAndUserId.mockResolvedValue(null);
    access = new CommunityAccessService(
      repository as never,
      prisma as never,
      moderators as never,
      { assertAllowed: jest.fn() } as never,
    );
  });

  describe('scope', () => {
    it('needs a signed-in user', async () => {
      await expect(access.scope('wuwa', undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('describes a member: who they are, the community, when they joined, and that they cannot moderate', async () => {
      const result = await access.scope('wuwa', 'me');

      expect(result).toMatchObject({
        user: { id: 'me' },
        game: { id: 'g1' },
        membership: { createdAt: new Date('2026-10-02T00:00:00Z') },
        canModerate: false,
      });
    });

    it.each([
      ['an unknown community', null],
      ['an archived community', { ...game, status: 'ARCHIVED' }],
      ['a hidden community', { ...game, status: 'HIDDEN' }],
    ])('does not exist for %s', async (_name, found) => {
      repository.findGameBySlug.mockResolvedValue(found);

      await expect(access.scope('wuwa', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('turns away someone who has not joined', async () => {
      repository.findMembership.mockResolvedValue(null);

      await expect(access.scope('wuwa', 'me')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets in a moderator who has not joined, as a moderator', async () => {
      repository.findMembership.mockResolvedValue(null);
      moderators.findByGameIdAndUserId.mockResolvedValue({ id: 'mod' });

      expect(await access.scope('wuwa', 'me')).toMatchObject({
        canModerate: true,
        membership: null,
      });
    });

    it('lets in an admin who has not joined, as a moderator', async () => {
      repository.findMembership.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'me',
        role: 'ADMIN',
        status: 'ACTIVE',
      });

      expect(await access.scope('wuwa', 'me')).toMatchObject({
        canModerate: true,
      });
    });

    it('lets a member who also moderates the community moderate', async () => {
      moderators.findByGameIdAndUserId.mockResolvedValue({ id: 'mod' });

      expect(await access.scope('wuwa', 'me')).toMatchObject({
        canModerate: true,
      });
    });

    it.each(['SUSPENDED', 'BANNED', 'DELETED'])(
      'turns away a %s account',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue({
          id: 'me',
          role: 'USER',
          status,
        });

        await expect(access.scope('wuwa', 'me')).rejects.toThrow(
          ForbiddenException,
        );
      },
    );
  });

  describe('channelIn', () => {
    it('finds a room of the community', async () => {
      repository.findChannel.mockResolvedValue(channel);

      expect(await access.channelIn('g1', 'c1')).toBe(channel);
      expect(repository.findChannel).toHaveBeenCalledWith('g1', 'c1');
    });

    it('does not find a room of another community, or an archived one', async () => {
      repository.findChannel.mockResolvedValue(null);

      await expect(access.channelIn('g1', 'elsewhere')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('messageIn', () => {
    it('finds a message of the community', async () => {
      const message = row();
      repository.findMessageInGame.mockResolvedValue(message);

      expect(await access.messageIn('g1', 'm1')).toBe(message);
      expect(repository.findMessageInGame).toHaveBeenCalledWith('m1', 'g1');
    });

    it('does not find a message of another community', async () => {
      repository.findMessageInGame.mockResolvedValue(null);

      await expect(access.messageIn('g1', 'elsewhere')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
