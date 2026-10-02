import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminGuard } from './guards/admin.guard';
import { DiscordLoggerService } from './discord/discord-logger.service';
import { IntegrityCheckRegistry } from './integrity/integrity-check.registry';
import { IntegrityService } from './integrity/integrity.service';
import { HttpExceptionFilter } from './filters/http-exception.filter';

/** Shared guards, the global exception filter, the Discord error logger, and the data-integrity sweep. */
@Module({
  providers: [
    AdminGuard,
    DiscordLoggerService,
    IntegrityCheckRegistry,
    IntegrityService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [AdminGuard, DiscordLoggerService, IntegrityCheckRegistry],
})
export class CommonModule {}
