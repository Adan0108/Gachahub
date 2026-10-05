import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { UsersRepository } from '../users.repository';
import { PROFILE_BANNERS } from './profile-banner-catalog';
import { UserBannerService } from './user-banner.service';

jest.mock('./profile-banner-catalog', () => {
  const actual = jest.requireActual<typeof import('./profile-banner-catalog')>(
    './profile-banner-catalog',
  );

  return {
    ...actual,
    PROFILE_BANNERS: [
      ...actual.PROFILE_BANNERS,
      { id: 'gilded-test', label: 'Gilded', tier: 'PREMIUM' },
    ],
  };
});

describe('UserBannerService', () => {
  const usersRepository = { setBannerPreset: jest.fn() };
  const freeId = PROFILE_BANNERS.find((b) => b.tier === 'FREE')!.id;

  let service: UserBannerService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UserBannerService(
      usersRepository as unknown as UsersRepository,
    );
  });

  describe('list', () => {
    it('marks FREE designs available and PREMIUM ones locked', () => {
      const byId = Object.fromEntries(
        service.list().map((b) => [b.id, b.available]),
      );

      expect(byId[freeId]).toBe(true);
      expect(byId['gilded-test']).toBe(false);
    });
  });

  describe('update', () => {
    it('saves a free design and returns the updated user', async () => {
      const user = { id: 'user-1', bannerPresetId: freeId };
      usersRepository.setBannerPreset.mockResolvedValue(user);

      await expect(
        service.update('user-1', { bannerPresetId: freeId }),
      ).resolves.toBe(user);

      expect(usersRepository.setBannerPreset).toHaveBeenCalledWith(
        'user-1',
        freeId,
      );
    });

    it('rejects an unknown design', async () => {
      await expect(
        service.update('user-1', { bannerPresetId: 'nope' }),
      ).rejects.toThrow(BadRequestException);

      expect(usersRepository.setBannerPreset).not.toHaveBeenCalled();
    });

    it('rejects a premium design the user cannot use yet', async () => {
      await expect(
        service.update('user-1', { bannerPresetId: 'gilded-test' }),
      ).rejects.toThrow(ForbiddenException);

      expect(usersRepository.setBannerPreset).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('clears the banner', async () => {
      usersRepository.setBannerPreset.mockResolvedValue({ id: 'user-1' });

      await service.remove('user-1');

      expect(usersRepository.setBannerPreset).toHaveBeenCalledWith(
        'user-1',
        null,
      );
    });
  });
});
