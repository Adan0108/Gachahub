import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { ChatDevicesRepository } from './chat-devices.repository';

/**
 * Purges expired MlsKeyPackage rows (critique C1's "run a job to remove
 * expired ones", never implemented in stage 3). They're already excluded
 * from claim queries by expiresAt, but nothing was ever deleting them -
 * mirrors MediaCleanupService's cron + Discord-on-failure shape, simpler
 * since there's no external asset to release first.
 */
@Injectable()
export class MlsKeyPackageCleanupService {
  private readonly logger = new Logger(MlsKeyPackageCleanupService.name);

  constructor(
    private readonly chatDevicesRepository: ChatDevicesRepository,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredKeyPackages(): Promise<void> {
    try {
      const deletedCount =
        await this.chatDevicesRepository.deleteExpiredKeyPackages();

      if (deletedCount > 0) {
        this.logger.log(`Deleted ${deletedCount} expired MLS key packages`);
      }
    } catch (error) {
      const errorName =
        error instanceof Error ? error.constructor.name : 'UnknownError';

      this.logger.error(
        'MLS key package cleanup job failed',
        error instanceof Error ? error.stack : undefined,
      );

      void this.discordLogger.sendError({
        source: 'cron',
        title: 'Cron job failed: cleanupExpiredKeyPackages',
        errorName,
        fields: [
          { name: 'Job', value: 'cleanupExpiredKeyPackages', inline: true },
          { name: 'Error', value: errorName, inline: true },
          {
            name: 'Message',
            value: error instanceof Error ? error.message : 'Unknown error',
            inline: false,
          },
        ],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
