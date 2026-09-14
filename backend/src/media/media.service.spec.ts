import { MediaService } from './media.service';

describe('MediaService', () => {
  const mediaRepository = {
    findById: jest.fn(),
    markDeleted: jest.fn(),
    findManyByIds: jest.fn(),
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
      cloudinaryService.deleteAsset.mockRejectedValue(new Error('cloudinary down'));

      await expect(service.releaseAttachedUpload('upload-1')).rejects.toThrow(
        'cloudinary down',
      );

      expect(mediaRepository.markDeleted).not.toHaveBeenCalled();
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
