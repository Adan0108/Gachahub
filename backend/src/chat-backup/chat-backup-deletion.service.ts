import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { MAX_DELETIONS_PER_RUN } from './chat-backup.constants';
import { ChatBackupRepository } from './chat-backup.repository';

/** Deletes every backup whose scheduled deletion has come due. */
@Injectable()
export class ChatBackupDeletionService {
  private readonly logger = new Logger(ChatBackupDeletionService.name);

  constructor(
    private readonly repository: ChatBackupRepository,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async deleteDueBackups(): Promise<void> {
    const now = new Date();
    let deleted = 0;

    try {
      const userIds = await this.repository.findDueDeletions(
        now,
        MAX_DELETIONS_PER_RUN,
      );

      for (const userId of userIds) {
        try {
          if (await this.repository.deleteAll(userId, now)) deleted += 1;
        } catch (error) {
          this.reportFailure(error);
        }
      }
    } catch (error) {
      this.reportFailure(error);
    }

    if (deleted > 0) {
      this.logger.log(`Chat backup: deleted ${deleted} scheduled backups`);
    }
  }

  private reportFailure(error: unknown): void {
    const errorName =
      error instanceof Error ? error.constructor.name : 'UnknownError';

    this.logger.error(
      'Scheduled chat backup deletion failed',
      error instanceof Error ? error.stack : undefined,
    );

    void this.discordLogger.sendError({
      source: 'cron',
      title: 'Cron job failed: deleteDueBackups',
      errorName,
      fields: [
        { name: 'Job', value: 'deleteDueBackups', inline: true },
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
