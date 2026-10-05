import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MediaService } from './media.service';

describe('MediaService', () => {
  const mediaRepository = {
    findById: jest.fn(),
    markDeleted: jest.fn(),
    findManyByIds: jest.fn(),
    markReleaseFailed: jest.fn(),
    claimForCleanup: jest.fn(),
  };

  const cloudinaryService = {
    deleteAsset: jest.fn(),
  };

  const redisService = {};

  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaService(
      mediaRepository as any,
      cloudinaryService as any,
      redisService as any,
    );
  });

  describe('destroyAttachedCloudinaryAsset', () => {
    it('destroys the cloudinary asset and returns true without touching the row', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'ATTACHED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });

      const released = await service.destroyAttachedCloudinaryAsset('upload-1');

      expect(released).toBe(true);
      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'image',
      );
      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
    });

    it('returns false without calling cloudinary when the upload is missing', async () => {
      mediaRepository.findById.mockResolvedValue(null);

      const released =
        await service.destroyAttachedCloudinaryAsset('missing-upload');

      expect(released).toBe(false);
      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
    });

    it('returns false without calling cloudinary when the upload is not ATTACHED', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'UPLOADED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });

      const released = await service.destroyAttachedCloudinaryAsset('upload-1');

      expect(released).toBe(false);
      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
    });

    it('also destroys the asset for an upload retrying after a previous failure', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'RELEASE_FAILED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });

      const released = await service.destroyAttachedCloudinaryAsset('upload-1');

      expect(released).toBe(true);
      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'image',
      );
    });
  });

  describe('removePendingUpload', () => {
    const pending = (status: 'INITIATED' | 'UPLOADED') => ({
      id: 'upload-1',
      userId: 'user-1',
      status,
      publicId: 'public-1',
      resourceType: 'IMAGE',
    });

    it('throws when the upload does not exist', async () => {
      mediaRepository.findById.mockResolvedValue(null);

      await expect(
        service.removePendingUpload('upload-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mediaRepository.claimForCleanup).not.toHaveBeenCalled();
    });

    it('throws when the caller does not own the upload', async () => {
      mediaRepository.findById.mockResolvedValue(pending('UPLOADED'));

      await expect(
        service.removePendingUpload('upload-1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mediaRepository.claimForCleanup).not.toHaveBeenCalled();
    });

    it('throws for an upload that is already ATTACHED or DELETED, without claiming it', async () => {
      mediaRepository.findById.mockResolvedValue({
        ...pending('UPLOADED'),
        status: 'ATTACHED',
      });

      await expect(
        service.removePendingUpload('upload-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mediaRepository.claimForCleanup).not.toHaveBeenCalled();
    });

    it('deletes the cloudinary asset and marks it deleted for an UPLOADED upload', async () => {
      mediaRepository.findById.mockResolvedValue(pending('UPLOADED'));
      mediaRepository.claimForCleanup.mockResolvedValue({ count: 1 });

      await service.removePendingUpload('upload-1', 'user-1');

      expect(mediaRepository.claimForCleanup).toHaveBeenCalledWith('upload-1');
      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'image',
      );
      expect(mediaRepository.markDeleted).toHaveBeenCalledWith('upload-1');
    });

    it('never touches cloudinary for an INITIATED upload (nothing was ever uploaded)', async () => {
      mediaRepository.findById.mockResolvedValue(pending('INITIATED'));
      mediaRepository.claimForCleanup.mockResolvedValue({ count: 1 });

      await service.removePendingUpload('upload-1', 'user-1');

      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
      expect(mediaRepository.markDeleted).toHaveBeenCalledWith('upload-1');
    });

    it('refuses the delete and never touches cloudinary when a concurrent send has already claimed the upload', async () => {
      // A concurrent attachMediaInTransaction() claim (UPLOADED -> ATTACHED) won
      // the race between this read and the reservation below.
      mediaRepository.findById.mockResolvedValue(pending('UPLOADED'));
      mediaRepository.claimForCleanup.mockResolvedValue({ count: 0 });

      await expect(
        service.removePendingUpload('upload-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
    });
  });

  describe('markReleaseFailed', () => {
    it('delegates to the repository', async () => {
      await service.markReleaseFailed('upload-1');

      expect(mediaRepository.markReleaseFailed).toHaveBeenCalledWith(
        'upload-1',
      );
    });
  });

  describe('releaseAttachedUpload', () => {
    it('deletes the cloudinary asset and marks the upload deleted', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'ATTACHED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });

      await service.releaseAttachedUpload('upload-1');

      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'image',
      );
      expect(mediaRepository.markDeleted).toHaveBeenCalledWith('upload-1');
    });

    it('maps VIDEO resourceType to the cloudinary "video" type', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'ATTACHED',
        publicId: 'public-1',
        resourceType: 'VIDEO',
      });

      await service.releaseAttachedUpload('upload-1');

      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'video',
      );
    });

    it('does nothing when the upload does not exist', async () => {
      mediaRepository.findById.mockResolvedValue(null);

      await service.releaseAttachedUpload('missing-upload');

      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
    });

    it('does nothing when the upload is not ATTACHED', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'UPLOADED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });

      await service.releaseAttachedUpload('upload-1');

      expect(cloudinaryService.deleteAsset).not.toHaveBeenCalled();
      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
    });

    it('propagates a cloudinary failure without marking the upload deleted', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'upload-1',
        status: 'ATTACHED',
        publicId: 'public-1',
        resourceType: 'IMAGE',
      });
      cloudinaryService.deleteAsset.mockRejectedValue(
        new Error('cloudinary down'),
      );

      await expect(service.releaseAttachedUpload('upload-1')).rejects.toThrow(
        'cloudinary down',
      );

      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
    });
  });

  describe('releaseReplacedUpload', () => {
    const attached = {
      id: 'upload-1',
      status: 'ATTACHED',
      publicId: 'public-1',
      resourceType: 'IMAGE',
    };

    beforeEach(() => {
      cloudinaryService.deleteAsset.mockResolvedValue(undefined);
      mediaRepository.markReleaseFailed.mockResolvedValue(undefined);
    });

    it('releases the upload on the happy path', async () => {
      mediaRepository.findById.mockResolvedValue(attached);

      await service.releaseReplacedUpload('upload-1');

      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'public-1',
        'image',
      );
      expect(mediaRepository.markDeleted).toHaveBeenCalledWith('upload-1');
      expect(mediaRepository.markReleaseFailed).not.toHaveBeenCalled();
    });

    it('flags RELEASE_FAILED instead of throwing when cloudinary fails', async () => {
      mediaRepository.findById.mockResolvedValue(attached);
      cloudinaryService.deleteAsset.mockRejectedValue(
        new Error('cloudinary down'),
      );

      await expect(
        service.releaseReplacedUpload('upload-1'),
      ).resolves.toBeUndefined();

      expect(mediaRepository.markReleaseFailed).toHaveBeenCalledWith(
        'upload-1',
      );
    });

    it('still resolves when flagging the failure also fails', async () => {
      mediaRepository.findById.mockResolvedValue(attached);
      cloudinaryService.deleteAsset.mockRejectedValue(
        new Error('cloudinary down'),
      );
      mediaRepository.markReleaseFailed.mockRejectedValue(new Error('db down'));

      await expect(
        service.releaseReplacedUpload('upload-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('resolveSingleImage', () => {
    const params = {
      id: 'upload-1',
      userId: 'user-1',
      purpose: 'AVATAR' as const,
      entityLabel: 'avatar',
    };
    const upload = {
      id: 'upload-1',
      userId: 'user-1',
      purpose: 'AVATAR',
      status: 'UPLOADED',
      resourceType: 'IMAGE',
      publicId: 'gachahub/avatar/user-1/asset-1',
      assetId: 'asset-1',
      secureUrl: 'https://res.cloudinary.com/avatar.png',
      format: 'png',
      bytes: 1000,
    };

    it('returns the id and secureUrl of the resolved upload', async () => {
      mediaRepository.findManyByIds.mockResolvedValue([upload]);

      await expect(service.resolveSingleImage(params)).resolves.toEqual({
        id: 'upload-1',
        secureUrl: 'https://res.cloudinary.com/avatar.png',
      });
    });

    it('rejects an upload with the wrong purpose', async () => {
      mediaRepository.findManyByIds.mockResolvedValue([
        { ...upload, purpose: 'GAME_ICON' },
      ]);

      await expect(service.resolveSingleImage(params)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a video', async () => {
      mediaRepository.findManyByIds.mockResolvedValue([
        { ...upload, resourceType: 'VIDEO' },
      ]);

      await expect(service.resolveSingleImage(params)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveAttachableMedia', () => {
    function uploadFixture(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'upload-1',
        userId: 'user-1',
        purpose: 'CHAT',
        status: 'UPLOADED',
        resourceType: 'IMAGE',
        publicId: 'gachahub/chat/user-1/asset-1',
        assetId: 'asset-1',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/asset-1.jpg',
        format: 'jpg',
        bytes: 1000,
        width: 100,
        height: 100,
        duration: null,
        ...overrides,
      };
    }

    it('returns [] without querying the repository when no ids are given', async () => {
      const result = await service.resolveAttachableMedia({
        ids: [],
        userId: 'user-1',
        purpose: 'CHAT',
        maxImages: 4,
        maxVideos: 1,
        entityLabel: 'chat message',
      });

      expect(result).toEqual([]);
      expect(mediaRepository.findManyByIds).not.toHaveBeenCalled();
    });

    it('returns the resolved uploads on the happy path', async () => {
      const upload = uploadFixture();
      mediaRepository.findManyByIds.mockResolvedValue([upload]);

      const result = await service.resolveAttachableMedia({
        ids: ['upload-1'],
        userId: 'user-1',
        purpose: 'CHAT',
        maxImages: 4,
        maxVideos: 1,
        entityLabel: 'chat message',
      });

      expect(result).toEqual([upload]);
    });

    it('rejects when a referenced upload cannot be found or attached', async () => {
      mediaRepository.findManyByIds.mockResolvedValue([]);

      await expect(
        service.resolveAttachableMedia({
          ids: ['missing-upload'],
          userId: 'user-1',
          purpose: 'CHAT',
          maxImages: 4,
          maxVideos: 1,
          entityLabel: 'chat message',
        }),
      ).rejects.toThrow('One or more media uploads do not exist');
    });

    it('rejects when the image count exceeds the caller limit', async () => {
      const uploads = [
        uploadFixture({ id: 'upload-1' }),
        uploadFixture({ id: 'upload-2' }),
      ];
      mediaRepository.findManyByIds.mockResolvedValue(uploads);

      await expect(
        service.resolveAttachableMedia({
          ids: ['upload-1', 'upload-2'],
          userId: 'user-1',
          purpose: 'CHAT',
          maxImages: 1,
          maxVideos: 1,
          entityLabel: 'chat message',
        }),
      ).rejects.toThrow('A chat message supports at most 1 image');
    });

    it('rejects when the video count exceeds the caller limit', async () => {
      const uploads = [
        uploadFixture({
          id: 'upload-1',
          resourceType: 'VIDEO',
          format: 'mp4',
          duration: 10,
        }),
        uploadFixture({
          id: 'upload-2',
          resourceType: 'VIDEO',
          format: 'mp4',
          duration: 10,
        }),
      ];
      mediaRepository.findManyByIds.mockResolvedValue(uploads);

      await expect(
        service.resolveAttachableMedia({
          ids: ['upload-1', 'upload-2'],
          userId: 'user-1',
          purpose: 'CHAT',
          maxImages: 4,
          maxVideos: 1,
          entityLabel: 'chat message',
        }),
      ).rejects.toThrow('A chat message supports at most 1 video');
    });

    it('rejects mixing images and video', async () => {
      const uploads = [
        uploadFixture({ id: 'upload-1', resourceType: 'IMAGE' }),
        uploadFixture({
          id: 'upload-2',
          resourceType: 'VIDEO',
          format: 'mp4',
          duration: 10,
        }),
      ];
      mediaRepository.findManyByIds.mockResolvedValue(uploads);

      await expect(
        service.resolveAttachableMedia({
          ids: ['upload-1', 'upload-2'],
          userId: 'user-1',
          purpose: 'CHAT',
          maxImages: 4,
          maxVideos: 1,
          entityLabel: 'chat message',
        }),
      ).rejects.toThrow('A chat message cannot mix images and video');
    });
  });
});
