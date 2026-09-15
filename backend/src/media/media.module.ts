import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  imports: [CommonModule],
  controllers: [MediaController],
  providers: [MediaService, MediaRepository, MediaCleanupService],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
