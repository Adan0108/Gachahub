import { BadRequestException, ConflictException } from '@nestjs/common';
import type { MediaService } from '../../media/media.service';
import {
  AvatarConflictError,
  type UserAvatarRepository,
} from './user-avatar.repository';
import { UserAvatarService } from './user-avatar.service';

describe('UserAvatarService', () => {
  const userAvatarRepository = { replace: jest.fn(), clear: jest.fn() };
  const mediaService = {
    resolveSingleImage: jest.fn(),
    releaseReplacedUpload: jest.fn(),
  };
  const upload = { id: 'upload-new', secureUrl: 'https://cdn/avatar.png' };
  const user = { id: 'user-1', image: upload.secureUrl };

  let service: UserAvatarService;

  beforeEach(() => {
    jest.resetAllMocks();
    mediaService.releaseReplacedUpload.mockResolvedValue(undefined);
    service = new UserAvatarService(
      userAvatarRepository as unknown as UserAvatarRepository,
      mediaService as unknown as MediaService,
    );
  });

  describe('update', () => {
    it('resolves an AVATAR upload owned by the caller, swaps it in, and returns the user', async () => {
      mediaService.resolveSingleImage.mockResolvedValue(upload);
      userAvatarRepository.replace.mockResolvedValue({
        user,
        previousUploadId: null,
      });

      const result = await service.update('user-1', {
        avatarMediaUploadId: 'upload-new',
      });

      expect(mediaService.resolveSingleImage).toHaveBeenCalledWith({
        id: 'upload-new',
        userId: 'user-1',
        purpose: 'AVATAR',
        entityLabel: 'avatar',
      });
      expect(userAvatarRepository.replace).toHaveBeenCalledWith(
        'user-1',
        upload,
      );
      expect(result).toBe(user);
    });

    it('does not release anything on a first-ever avatar', async () => {
      mediaService.resolveSingleImage.mockResolvedValue(upload);
      userAvatarRepository.replace.mockResolvedValue({
        user,
        previousUploadId: null,
      });

      await service.update('user-1', { avatarMediaUploadId: 'upload-new' });

      expect(mediaService.releaseReplacedUpload).not.toHaveBeenCalled();
    });

    it('releases the replaced upload after the swap commits', async () => {
      mediaService.resolveSingleImage.mockResolvedValue(upload);
      userAvatarRepository.replace.mockResolvedValue({
        user,
        previousUploadId: 'upload-old',
      });

      await service.update('user-1', { avatarMediaUploadId: 'upload-new' });

      expect(mediaService.releaseReplacedUpload).toHaveBeenCalledWith(
        'upload-old',
      );
    });

    it('propagates media validation failures without touching the user', async () => {
      mediaService.resolveSingleImage.mockRejectedValue(
        new BadRequestException('wrong purpose'),
      );

      await expect(
        service.update('user-1', { avatarMediaUploadId: 'upload-new' }),
      ).rejects.toThrow(BadRequestException);

      expect(userAvatarRepository.replace).not.toHaveBeenCalled();
    });

    it('maps a lost race to 409 and releases nothing', async () => {
      mediaService.resolveSingleImage.mockResolvedValue(upload);
      userAvatarRepository.replace.mockRejectedValue(new AvatarConflictError());

      await expect(
        service.update('user-1', { avatarMediaUploadId: 'upload-new' }),
      ).rejects.toThrow(ConflictException);

      expect(mediaService.releaseReplacedUpload).not.toHaveBeenCalled();
    });

    it('rethrows unexpected repository errors unchanged', async () => {
      mediaService.resolveSingleImage.mockResolvedValue(upload);
      userAvatarRepository.replace.mockRejectedValue(new Error('db down'));

      await expect(
        service.update('user-1', { avatarMediaUploadId: 'upload-new' }),
      ).rejects.toThrow('db down');
    });
  });

  describe('remove', () => {
    it('clears the avatar and releases the old upload', async () => {
      userAvatarRepository.clear.mockResolvedValue({
        user: { id: 'user-1', image: null },
        previousUploadId: 'upload-old',
      });

      await service.remove('user-1');

      expect(userAvatarRepository.clear).toHaveBeenCalledWith('user-1');
      expect(mediaService.releaseReplacedUpload).toHaveBeenCalledWith(
        'upload-old',
      );
    });

    it('releases nothing when there was no backing upload', async () => {
      userAvatarRepository.clear.mockResolvedValue({
        user: { id: 'user-1', image: null },
        previousUploadId: null,
      });

      await service.remove('user-1');

      expect(mediaService.releaseReplacedUpload).not.toHaveBeenCalled();
    });

    it('maps a lost race to 409', async () => {
      userAvatarRepository.clear.mockRejectedValue(new AvatarConflictError());

      await expect(service.remove('user-1')).rejects.toThrow(ConflictException);
    });
  });
});
