import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { UserModerationService } from './user-moderation.service';
import { UsersRepository } from './users.repository';
import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';
import { PostsModule } from '../posts/posts.module';
import { BlocksModule } from '../blocks/blocks.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SessionTerminatorModule } from '../auth/session-terminator.module';

@Module({
  imports: [PostsModule, BlocksModule, AuditLogModule, SessionTerminatorModule],
  controllers: [UsersController, AdminUsersController],
  providers: [
    UsersService,
    UserModerationService,
    UsersRepository,
    UserSearchRateLimiterService,
  ],
})
export class UsersModule {}
