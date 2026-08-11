import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { auth } from './auth/auth';
import { ChatModule } from './chat/chat.module';
import { GameCategoriesModule } from './game-categories/game-categories.module';
import { GamesModule } from './games/games.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { PostsModule } from './posts/posts.module';
import { GameModeratorsModule } from './game-moderators/game-moderators.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { MediaModule } from './media/media.module';
import { CommentsModule } from './comments/comments.module';

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
    MediaModule,
    PostsModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
