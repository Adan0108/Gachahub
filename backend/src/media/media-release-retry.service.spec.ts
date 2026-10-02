import { MediaReleaseRetryService } from './media-release-retry.service';

describe('MediaReleaseRetryService', () => {
  const mediaRepository = {
    findReleaseFailedUploads: jest.fn(),
    finalizeReleasedUpload: jest.fn(),
  };

  const mediaService = {
    destroyAttachedCloudinaryAsset: jest.fn(),
    markReleaseFailed: jest.fn().mockResolvedValue(undefined),
  };

  let service: MediaReleaseRetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaReleaseRetryService(
      mediaRepository as any,
      mediaService as any,
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
    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
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

    expect(mediaRepository.finalizeReleasedUpload).not.toHaveBeenCalled();
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

    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
      'upload-2',
    );
    expect(mediaService.markReleaseFailed).toHaveBeenCalledWith('upload-1');
  });

  it('retries RELEASE_FAILED uploads regardless of purpose, not just chat ones', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([
      { id: 'chat-upload', purpose: 'CHAT' },
      { id: 'game-icon-upload', purpose: 'GAME_ICON' },
      { id: 'banner-upload', purpose: 'BANNER' },
    ]);
    mediaService.destroyAttachedCloudinaryAsset.mockResolvedValue(true);

    await service.retryFailedReleases();

    expect(mediaService.destroyAttachedCloudinaryAsset).toHaveBeenCalledTimes(
      3,
    );
    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
      'chat-upload',
    );
    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
      'game-icon-upload',
    );
    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
      'banner-upload',
    );
  });
});
