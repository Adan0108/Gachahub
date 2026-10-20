import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GroupPhotoConflictError } from './chat-group-photo.repository';
import { ChatGroupPhotoService } from './chat-group-photo.service';

describe('ChatGroupPhotoService', () => {
  const access = { assertCanManageGroup: jest.fn() };
  const repository = { replace: jest.fn(), clear: jest.fn() };
  const media = {
    resolveSingleImage: jest.fn(),
    releaseReplacedUpload: jest.fn(),
  };
  let service: ChatGroupPhotoService;

  beforeEach(() => {
    jest.resetAllMocks();
    access.assertCanManageGroup.mockResolvedValue({});
    media.resolveSingleImage.mockResolvedValue({
      id: 'upload-new',
      secureUrl: 'https://res.cloudinary.com/x/new.png',
    });
    media.releaseReplacedUpload.mockResolvedValue(undefined);
    service = new ChatGroupPhotoService(
      access as never,
      repository as never,
      media as never,
    );
  });

  describe('update', () => {
    it('checks the upload is a group photo image of the caller, then swaps it in', async () => {
      repository.replace.mockResolvedValue({
        conversation: { id: 'g1', photoUrl: 'new' },
        previousUploadId: null,
      });

      const result = await service.update('me', 'g1', {
        photoMediaUploadId: 'upload-new',
      });

      expect(access.assertCanManageGroup).toHaveBeenCalledWith('me', 'g1');
      expect(media.resolveSingleImage).toHaveBeenCalledWith({
        id: 'upload-new',
        userId: 'me',
        purpose: 'GROUP_PHOTO',
        entityLabel: 'group photo',
      });
      expect(repository.replace).toHaveBeenCalledWith('g1', 'me', {
        id: 'upload-new',
        secureUrl: 'https://res.cloudinary.com/x/new.png',
      });
      expect(result).toEqual({ id: 'g1', photoUrl: 'new' });
    });

    it('releases the photo it replaced', async () => {
      repository.replace.mockResolvedValue({
        conversation: { id: 'g1' },
        previousUploadId: 'upload-old',
      });

      await service.update('me', 'g1', { photoMediaUploadId: 'upload-new' });

      expect(media.releaseReplacedUpload).toHaveBeenCalledWith('upload-old');
    });

    it('does nothing for someone who cannot manage the group', async () => {
      access.assertCanManageGroup.mockRejectedValue(new ForbiddenException());

      await expect(
        service.update('me', 'g1', { photoMediaUploadId: 'upload-new' }),
      ).rejects.toThrow(ForbiddenException);
      expect(media.resolveSingleImage).not.toHaveBeenCalled();
      expect(repository.replace).not.toHaveBeenCalled();
    });

    it('is a 409 when the photo was changed elsewhere meanwhile, and releases nothing', async () => {
      repository.replace.mockRejectedValue(new GroupPhotoConflictError());

      await expect(
        service.update('me', 'g1', { photoMediaUploadId: 'upload-new' }),
      ).rejects.toThrow(ConflictException);
      expect(media.releaseReplacedUpload).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('clears the photo and releases it', async () => {
      repository.clear.mockResolvedValue({
        conversation: { id: 'g1', photoUrl: null },
        previousUploadId: 'upload-old',
      });

      const result = await service.remove('me', 'g1');

      expect(access.assertCanManageGroup).toHaveBeenCalledWith('me', 'g1');
      expect(media.releaseReplacedUpload).toHaveBeenCalledWith('upload-old');
      expect(result).toEqual({ id: 'g1', photoUrl: null });
    });

    it('releases nothing when the photo was only a legacy URL with no upload', async () => {
      repository.clear.mockResolvedValue({
        conversation: { id: 'g1' },
        previousUploadId: null,
      });

      await service.remove('me', 'g1');

      expect(media.releaseReplacedUpload).not.toHaveBeenCalled();
    });
  });
});
