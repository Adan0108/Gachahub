import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MediaRepository } from './media.repository';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Removes orphaned uploads that were never attached to a Post, Comment
   * or ChatMessage.
   *
   * The job processes a small batch so one run cannot monopolize the
   * application or Cloudinary API.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredUploads(): Promise<void> {
    const expiryHours = Number(process.env.MEDIA_UPLOAD_EXPIRES_HOURS ?? 24);

    if (!Number.isFinite(expiryHours) || expiryHours <= 0) {
      throw new Error('MEDIA_UPLOAD_EXPIRES_HOURS must be a positive number');
    }

    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const uploads = await this.mediaRepository.findExpiredUploads(cutoff, 100);

    for (const upload of uploads) {
      try {
        const claimed = await this.mediaRepository.claimForCleanup(upload.id);

        if (claimed.count === 0) {
          continue;
        }
        if (upload.status === 'UPLOADED') {
          await this.cloudinaryService.deleteAsset(
            upload.publicId,
            upload.resourceType === 'IMAGE' ? 'image' : 'video',
          );
        }

        await this.mediaRepository.markDeleted(upload.id);
      } catch (error) {
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
