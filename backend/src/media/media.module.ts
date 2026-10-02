import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaReleaseRetryService } from './media-release-retry.service';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  imports: [CommonModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaRepository,
    MediaCleanupService,
    MediaReleaseRetryService,
  ],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
