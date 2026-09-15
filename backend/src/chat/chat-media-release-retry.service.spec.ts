import { ChatMediaReleaseRetryService } from './chat-media-release-retry.service';

describe('ChatMediaReleaseRetryService', () => {
  const mediaRepository = {
    findReleaseFailedUploads: jest.fn(),
  };

  const mediaService = {
    destroyAttachedCloudinaryAsset: jest.fn(),
    markReleaseFailed: jest.fn().mockResolvedValue(undefined),
  };

  const chatRepository = {
    finalizeReleasedMedia: jest.fn(),
  };

  let service: ChatMediaReleaseRetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatMediaReleaseRetryService(
      mediaRepository as any,
      mediaService as any,
      chatRepository as any,
    );
  });

  it('does nothing when there is nothing to retry', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([]);

    await service.retryFailedReleases();

    expect(mediaService.destroyAttachedCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('finalizes an upload that releases successfully on retry', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([
      { id: 'upload-1' },
    ]);
    mediaService.destroyAttachedCloudinaryAsset.mockResolvedValue(true);

    await service.retryFailedReleases();

    expect(mediaService.destroyAttachedCloudinaryAsset).toHaveBeenCalledWith(
      'upload-1',
    );
    expect(chatRepository.finalizeReleasedMedia).toHaveBeenCalledWith(
      'upload-1',
    );
    expect(mediaService.markReleaseFailed).not.toHaveBeenCalled();
  });

  it('re-flags an upload that fails again instead of finalizing it', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([
      { id: 'upload-1' },
    ]);
    mediaService.destroyAttachedCloudinaryAsset.mockRejectedValue(
      new Error('cloudinary down'),
    );

    await service.retryFailedReleases();

    expect(chatRepository.finalizeReleasedMedia).not.toHaveBeenCalled();
    expect(mediaService.markReleaseFailed).toHaveBeenCalledWith('upload-1');
  });

  it('processes the rest even when one upload keeps failing', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([
      { id: 'upload-1' },
      { id: 'upload-2' },
    ]);
    mediaService.destroyAttachedCloudinaryAsset.mockImplementation(
      (id: string) =>
        id === 'upload-1'
          ? Promise.reject(new Error('cloudinary down'))
          : Promise.resolve(true),
    );

    await service.retryFailedReleases();

    expect(chatRepository.finalizeReleasedMedia).toHaveBeenCalledWith(
      'upload-2',
    );
    expect(mediaService.markReleaseFailed).toHaveBeenCalledWith('upload-1');
  });
});
