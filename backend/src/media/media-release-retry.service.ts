import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

/** Releases media whose Cloudinary delete failed, plus replaced single-image uploads a crash left unreleased, regardless of purpose. */
@Injectable()
export class MediaReleaseRetryService {
  private readonly logger = new Logger(MediaReleaseRetryService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaService: MediaService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async retryFailedReleases(): Promise<void> {
    const retryCutoff = new Date(Date.now() - 60 * 60 * 1000);
    const [failed, orphaned] = await Promise.all([
      this.mediaRepository.findReleaseFailedUploads(retryCutoff, 50),
      this.mediaRepository.findOrphanedSingleImageUploads(retryCutoff, 50),
    ]);
    const uploads = [...failed, ...orphaned];

    for (const upload of uploads) {
      try {
        const released = await this.mediaService.destroyAttachedCloudinaryAsset(
          upload.id,
        );

        if (released) {
          await this.mediaRepository.finalizeReleasedUpload(upload.id);
        }
      } catch (error) {
        this.logger.warn(
          `Retry failed releasing media ${upload.id}, will retry again next hour`,
          error instanceof Error ? error.stack : undefined,
        );

        await this.mediaService.markReleaseFailed(upload.id).catch(() => {
          // Already RELEASE_FAILED or gone; the next sweep handles it.
        });
      }
    }

    if (uploads.length > 0) {
      this.logger.log(
        `Retried releasing ${uploads.length} previously-failed media uploads`,
      );
    }
  }
}
