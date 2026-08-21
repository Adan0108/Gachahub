import { Module } from '@nestjs/common';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaRepository, MediaCleanupService],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
