import { NotFoundException } from '@nestjs/common';
import { UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  const prisma = { user: { findFirst: jest.fn() } };
  const blocks = { isBlocked: jest.fn() };
  const follows = { getFollowStatus: jest.fn(), getCounts: jest.fn() };
  const posts = { countByAuthorPublic: jest.fn() };
  const profileAccess = { canView: jest.fn() };
  let service: UserProfileService;

  const fields = {
    id: 'user-2',
    name: 'Yumemi',
    username: 'yumemi',
    image: null,
    bannerPresetId: null,
    bio: 'hello',
    createdAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findFirst.mockResolvedValue(fields);
    blocks.isBlocked.mockResolvedValue(false);
    follows.getFollowStatus.mockResolvedValue({
      following: false,
      followsMe: false,
    });
    follows.getCounts.mockResolvedValue({ followers: 5, following: 2 });
    posts.countByAuthorPublic.mockResolvedValue(9);
    profileAccess.canView.mockResolvedValue(true);
    service = new UserProfileService(
      prisma as never,
      blocks as never,
      follows as never,
      posts as never,
      profileAccess as never,
    );
  });

  it('is not found for a user who does not exist or is not active', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getPublicProfile('missing', 'viewer')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing', status: 'ACTIVE' } }),
    );
    expect(blocks.isBlocked).not.toHaveBeenCalled();
  });

  it('gives the profile with its bio, counts and how the viewer relates to them', async () => {
    blocks.isBlocked.mockResolvedValue(true);
    follows.getFollowStatus.mockResolvedValue({
      following: true,
      followsMe: true,
    });

    const profile = await service.getPublicProfile('user-2', 'viewer');

    expect(profile).toEqual({
      ...fields,
      reputation: 0,
      rank: 'STARGAZER',
      isBlockedByMe: true,
      isFollowing: true,
      followsYou: true,
      isPrivate: false,
      counts: { posts: 9, followers: 5, following: 2 },
    });
    expect(posts.countByAuthorPublic).toHaveBeenCalledWith('user-2', 'viewer');
  });

  it('has no relation for someone not signed in, and none to yourself', async () => {
    const anonymous = await service.getPublicProfile('user-2');
    const own = await service.getPublicProfile('user-2', 'user-2');

    for (const profile of [anonymous, own]) {
      expect(profile).toMatchObject({
        isBlockedByMe: false,
        isFollowing: false,
        followsYou: false,
      });
    }
    expect(blocks.isBlocked).not.toHaveBeenCalled();
    expect(follows.getFollowStatus).not.toHaveBeenCalled();
  });

  it('keeps bio and counts out of a profile the viewer may not see', async () => {
    profileAccess.canView.mockResolvedValue(false);

    const profile = await service.getPublicProfile('user-2', 'viewer');

    expect(profile).toMatchObject({
      id: 'user-2',
      name: 'Yumemi',
      bio: null,
      isPrivate: true,
      counts: null,
    });
    expect(follows.getCounts).not.toHaveBeenCalled();
    expect(posts.countByAuthorPublic).not.toHaveBeenCalled();
  });
});
