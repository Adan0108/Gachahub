import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { UserModerationService } from './user-moderation.service';
import { UsersRepository } from './users.repository';
import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';
import { UsernameAvailabilityRateLimiterService } from './username-availability-rate-limiter.service';
import { PostsModule } from '../posts/posts.module';
import { BlocksModule } from '../blocks/blocks.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SessionTerminatorModule } from '../auth/session-terminator.module';
import { MediaModule } from '../media/media.module';
import { UserAvatarController } from './avatar/user-avatar.controller';
import { UserAvatarRepository } from './avatar/user-avatar.repository';
import { UserAvatarService } from './avatar/user-avatar.service';
import { UserBannerController } from './banner/user-banner.controller';
import { UserBannerService } from './banner/user-banner.service';

@Module({
  imports: [
    PostsModule,
    BlocksModule,
    AuditLogModule,
    SessionTerminatorModule,
    MediaModule,
  ],
  controllers: [
    UsersController,
    AdminUsersController,
    UserAvatarController,
    UserBannerController,
  ],
  providers: [
    UsersService,
    UserModerationService,
    UsersRepository,
    UserAvatarService,
    UserAvatarRepository,
    UserBannerService,
    UserSearchRateLimiterService,
    UsernameAvailabilityRateLimiterService,
  ],
  exports: [UsersRepository],
})
export class UsersModule {}
