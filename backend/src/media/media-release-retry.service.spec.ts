import { MediaReleaseRetryService } from './media-release-retry.service';

describe('MediaReleaseRetryService', () => {
  const mediaRepository = {
    findReleaseFailedUploads: jest.fn(),
    findOrphanedSingleImageUploads: jest.fn(),
    finalizeReleasedUpload: jest.fn(),
  };

  const mediaService = {
    destroyAttachedCloudinaryAsset: jest.fn(),
    markReleaseFailed: jest.fn().mockResolvedValue(undefined),
  };

  let service: MediaReleaseRetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    mediaRepository.findOrphanedSingleImageUploads.mockResolvedValue([]);
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

describe('MediaReleaseRetryService orphan sweep', () => {
  const mediaRepository = {
    findReleaseFailedUploads: jest.fn(),
    findOrphanedSingleImageUploads: jest.fn(),
    finalizeReleasedUpload: jest.fn(),
  };
  const mediaService = {
    destroyAttachedCloudinaryAsset: jest.fn(),
    markReleaseFailed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MediaReleaseRetryService(
    mediaRepository as any,
    mediaService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([]);
    mediaService.destroyAttachedCloudinaryAsset.mockResolvedValue(true);
  });

  it('releases an unreferenced single-image upload left behind by a crash', async () => {
    mediaRepository.findOrphanedSingleImageUploads.mockResolvedValue([
      { id: 'orphan-1', purpose: 'AVATAR' },
    ]);

    await service.retryFailedReleases();

    expect(mediaService.destroyAttachedCloudinaryAsset).toHaveBeenCalledWith(
      'orphan-1',
    );
    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledWith(
      'orphan-1',
    );
  });

  it('handles failed releases and orphans in the same sweep', async () => {
    mediaRepository.findReleaseFailedUploads.mockResolvedValue([
      { id: 'failed-1' },
    ]);
    mediaRepository.findOrphanedSingleImageUploads.mockResolvedValue([
      { id: 'orphan-1' },
    ]);

    await service.retryFailedReleases();

    expect(mediaRepository.finalizeReleasedUpload).toHaveBeenCalledTimes(2);
  });

  it('only looks at uploads idle for an hour, so an in-flight release is not raced', async () => {
    mediaRepository.findOrphanedSingleImageUploads.mockResolvedValue([]);
    const before = Date.now() - 60 * 60 * 1000;

    await service.retryFailedReleases();

    const [cutoff] = mediaRepository.findOrphanedSingleImageUploads.mock
      .calls[0] as [Date];
    expect(Math.abs(cutoff.getTime() - before)).toBeLessThan(5000);
  });
});
