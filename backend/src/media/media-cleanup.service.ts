import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MediaRepository } from './media.repository';
import { cloudinaryResourceTypeFor } from './opaque-blob';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly cloudinaryService: CloudinaryService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  /** Cron entry point; reports a runCleanup failure to Discord. */
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

  /** Removes orphaned uploads never attached, in small batches; stale CLEANING rows are retried. */
  private async runCleanup(): Promise<void> {
    const expiryHours = Number(process.env.MEDIA_UPLOAD_EXPIRES_HOURS ?? 24);

    if (!Number.isFinite(expiryHours) || expiryHours <= 0) {
      throw new Error('MEDIA_UPLOAD_EXPIRES_HOURS must be a positive number');
    }

    const now = Date.now();

    /** INITIATED and UPLOADED uploads older than this count as orphaned. */
    const normalCutoff = new Date(now - expiryHours * 60 * 60 * 1000);

    /** CLEANING rows older than an hour are treated as failed attempts and retried. */
    const cleaningCutoff = new Date(now - 60 * 60 * 1000);

    const uploads = await this.mediaRepository.findExpiredUploads(
      normalCutoff,
      cleaningCutoff,
      100,
    );

    for (const upload of uploads) {
      try {
        // Expired uploads are claimed atomically so they cannot be attached mid-delete.
        if (upload.status !== 'CLEANING') {
          const claimed = await this.mediaRepository.claimForCleanup(upload.id);

          if (claimed.count === 0) {
            continue;
          }
        } else {
          // Reclaims a stale CLEANING row; the updatedAt condition lets only one instance win.
          const reclaimed = await this.mediaRepository.reclaimStaleCleanup(
            upload.id,
            cleaningCutoff,
          );

          if (reclaimed.count === 0) {
            continue;
          }
        }

        // Always delete the Cloudinary asset once claimed; INITIATED rows may have uploaded without confirming.
        await this.cloudinaryService.deleteAsset(
          upload.publicId,
          cloudinaryResourceTypeFor(upload),
        );

        // Mark deleted only after Cloudinary cleanup succeeds.
        await this.mediaRepository.markDeleted(upload.id);
      } catch (error) {
        // On failure leave the row CLEANING; it is retried after an hour.
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
