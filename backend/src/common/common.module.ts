import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminGuard } from './guards/admin.guard';
import { DiscordLoggerService } from './discord/discord-logger.service';
import { HttpExceptionFilter } from './filters/http-exception.filter';

/** Shared guards, the global exception filter, and the Discord error logger it uses. */
@Module({
  providers: [
    AdminGuard,
    DiscordLoggerService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [AdminGuard, DiscordLoggerService],
})
export class CommonModule {}
