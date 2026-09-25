import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { ChatDevicesRepository } from './chat-devices.repository';

/** A device unseen this long is retired; a member's next full pass then removes it from groups (Signal delinks at ~30-45 days). */
const RETIRE_UNSEEN_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

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

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async retireDormantDevices(): Promise<void> {
    try {
      const retired = await this.chatDevicesRepository.retireDevicesUnseenSince(
        new Date(Date.now() - RETIRE_UNSEEN_AFTER_MS),
      );

      if (retired > 0) {
        this.logger.log(`Retired ${retired} dormant MLS devices`);
      }
    } catch (error) {
      const errorName =
        error instanceof Error ? error.constructor.name : 'UnknownError';

      this.logger.error(
        'Dormant device retirement job failed',
        error instanceof Error ? error.stack : undefined,
      );

      void this.discordLogger.sendError({
        source: 'cron',
        title: 'Cron job failed: retireDormantDevices',
        errorName,
        fields: [
          { name: 'Job', value: 'retireDormantDevices', inline: true },
          { name: 'Error', value: errorName, inline: true },
        ],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

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
