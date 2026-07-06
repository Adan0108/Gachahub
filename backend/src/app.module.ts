import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { auth } from './auth/auth';
import { GameCategoriesModule } from './game-categories/game-categories.module';
import { GamesModule } from './games/games.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

/**
 * Root application module.
 *
 * This module connects all feature modules and system modules together.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule.forRoot({ auth }),
    HealthModule,
    UsersModule,
    GamesModule,
    GameCategoriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
