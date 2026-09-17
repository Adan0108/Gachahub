import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaRepository } from '../media/media.repository';
import { MediaService } from '../media/media.service';
import { ChatRepository } from './chat.repository';

/**
 * Retries releasing chat media uploads whose Cloudinary delete failed when
 * their message was deleted (see ChatService.releaseDeletedMessageMedia).
 *
 * Lives in the chat module rather than MediaCleanupService because only
 * chat attaches-then-releases media on delete today - posts don't have that
 * flow yet. RELEASE_FAILED uploads would otherwise sit ATTACHED forever,
 * since ATTACHED is permanently excluded from the general cleanup sweep.
 */
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
        const released =
          await this.mediaService.destroyAttachedCloudinaryAsset(upload.id);

        if (released) {
          await this.chatRepository.finalizeReleasedMedia(upload.id);
        }
      } catch (error) {
        this.logger.warn(
          `Retry failed releasing media ${upload.id}, will retry again next hour`,
          error instanceof Error ? error.stack : undefined,
        );

        await this.mediaService.markReleaseFailed(upload.id).catch(() => {
          // already RELEASE_FAILED, or the row is gone - either way, next
          // sweep's query naturally handles it, nothing more to do here
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
