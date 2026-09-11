import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MediaRepository } from './media.repository';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly cloudinaryService: CloudinaryService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  /**
   * Cron entry point, delegates to runCleanup and reports any failure
   * to discord instead of letting it fail silently
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredUploads(): Promise<void> {
    try {
      await this.runCleanup();
    } catch (error) {
      const errorName =
        error instanceof Error ? error.constructor.name : 'UnknownError';

      this.logger.error(
        'Media cleanup job failed',
        error instanceof Error ? error.stack : undefined,
      );

      void this.discordLogger.sendError({
        source: 'cron',
        title: 'Cron job failed: cleanupExpiredUploads',
        errorName,
        fields: [
          { name: 'Job', value: 'cleanupExpiredUploads', inline: true },
          { name: 'Error', value: errorName, inline: true },
          {
            name: 'Message',
            value: error instanceof Error ? error.message : 'Unknown error',
            inline: false,
          },
        ],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Removes orphaned uploads that were never attached to a Post, Comment
   * or ChatMessage.
   *
   * The job processes a small batch so one run cannot monopolize the
   * application or Cloudinary API.
   *
   * Stale CLEANING rows are retried because a previous cleanup attempt
   * may have failed or the application may have stopped mid-cleanup.
   */
  private async runCleanup(): Promise<void> {
    const expiryHours = Number(process.env.MEDIA_UPLOAD_EXPIRES_HOURS ?? 24);

    if (!Number.isFinite(expiryHours) || expiryHours <= 0) {
      throw new Error('MEDIA_UPLOAD_EXPIRES_HOURS must be a positive number');
    }

    const now = Date.now();

    /**
     * INITIATED and UPLOADED uploads older than this are considered
     * orphaned and eligible for cleanup.
     */
    const normalCutoff = new Date(now - expiryHours * 60 * 60 * 1000);

    /**
     * CLEANING normally lasts only a few seconds.
     *
     * If a row has remained CLEANING for more than one hour, a previous
     * cleanup attempt likely failed or the process stopped before the
     * database could be updated to DELETED.
     */
    const cleaningCutoff = new Date(now - 60 * 60 * 1000);

    const uploads = await this.mediaRepository.findExpiredUploads(
      normalCutoff,
      cleaningCutoff,
      100,
    );

    for (const upload of uploads) {
      try {
        /**
         * Normal expired uploads must first be atomically claimed.
         *
         * This prevents an upload from being attached to a feature while
         * the cleanup job is deleting the corresponding Cloudinary asset.
         */
        if (upload.status !== 'CLEANING') {
          const claimed = await this.mediaRepository.claimForCleanup(upload.id);

          if (claimed.count === 0) {
            continue;
          }
        } else {
          /**
           * A stale CLEANING upload is reclaimed before retrying.
           *
           * The updatedAt condition ensures that only one application
           * instance can successfully reclaim the stale row.
           */
          const reclaimed = await this.mediaRepository.reclaimStaleCleanup(
            upload.id,
            cleaningCutoff,
          );

          if (reclaimed.count === 0) {
            continue;
          }
        }

        /**
         * Always attempt to remove the Cloudinary asset after successfully
         * claiming the upload.
         *
         * INITIATED rows are included because the frontend may have
         * successfully uploaded the asset to Cloudinary but failed to call
         * the backend confirmation endpoint afterwards.
         */
        await this.cloudinaryService.deleteAsset(
          upload.publicId,
          upload.resourceType === 'IMAGE' ? 'image' : 'video',
        );

        /**
         * Only mark the database row as deleted after the Cloudinary
         * cleanup completes successfully.
         */
        await this.mediaRepository.markDeleted(upload.id);
      } catch (error) {
        /**
         * Leave the upload in CLEANING when cleanup fails.
         *
         * Once it has remained CLEANING for more than one hour, a future
         * cron execution will pick it up and retry the cleanup.
         */
        this.logger.error(
          `Failed to clean media upload ${upload.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (uploads.length > 0) {
      this.logger.log(`Processed ${uploads.length} expired media uploads`);
    }
  }
}
