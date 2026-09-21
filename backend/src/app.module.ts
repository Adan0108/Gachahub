import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@thallesp/nestjs-better-auth';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { auth } from './auth/auth';
import { ChatDevicesModule } from './chat-devices/chat-devices.module';
import { ChatModule } from './chat/chat.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { CommonModule } from './common/common.module';
import { env } from './config/env';
import { CommentsModule } from './comments/comments.module';
import { DevModule } from './dev/dev.module';
import { FeedModule } from './feed/feed.module';
import { FollowsModule } from './follows/follows.module';
import { GameCategoriesModule } from './game-categories/game-categories.module';
import { GameModeratorsModule } from './game-moderators/game-moderators.module';
import { GamesModule } from './games/games.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { MlsHandshakesModule } from './mls-handshakes/mls-handshakes.module';
import { NotificationModule } from './notifications/notification.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

/**
 * Root application module.
 *
 * This module connects all feature modules and system modules together.
 */
@Module({
  imports: [
    /*
     * Provides scheduled cleanup jobs for orphaned Cloudinary uploads.
     */
    ScheduleModule.forRoot(),

    CommonModule,
    CloudinaryModule,
    PrismaModule,
    RedisModule,

    AuthModule.forRoot({ auth }),

    HealthModule,
    UsersModule,

    GamesModule,
    GameCategoriesModule,
    GameModeratorsModule,

    ChatModule,
    ChatDevicesModule,
    MlsHandshakesModule,

    MediaModule,
    PostsModule,
    CommentsModule,
    FollowsModule,
    FeedModule,

    NotificationModule,

    // Test-user spawn/impersonate/delete tooling - registered only in
    // development so the routes don't exist at all (not just guarded) once
    // NODE_ENV is anything else. Fail-closed on purpose: this module can
    // mint a session for any user id with no password check.
    ...(env.nodeEnv === 'development' ? [DevModule] : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
