import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { CommentsModule } from '../comments/comments.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminContentController } from './admin-content.controller';
import { ContentModerationService } from './content-moderation.service';

@Module({
  imports: [PostsModule, CommentsModule, ReportsModule],
  controllers: [AdminContentController],
  providers: [ContentModerationService],
})
export class ContentModerationModule {}
