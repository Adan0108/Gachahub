import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaRepository } from '../media/media.repository';
import { MediaService } from '../media/media.service';
import { ChatRepository } from './chat.repository';

/** Retries releasing chat media whose Cloudinary delete failed after its message was deleted. */
@Injectable()
export class ChatMediaReleaseRetryService {
  private readonly logger = new Logger(ChatMediaReleaseRetryService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaService: MediaService,
    private readonly chatRepository: ChatRepository,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async retryFailedReleases(): Promise<void> {
    const retryCutoff = new Date(Date.now() - 60 * 60 * 1000);
    const uploads = await this.mediaRepository.findReleaseFailedUploads(
      retryCutoff,
      50,
    );

    for (const upload of uploads) {
      try {
        const released = await this.mediaService.destroyAttachedCloudinaryAsset(
          upload.id,
        );

        if (released) {
          await this.chatRepository.finalizeReleasedMedia(upload.id);
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
