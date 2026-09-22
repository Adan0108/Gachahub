import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../discord/discord-logger.service';
import type { IntegrityCheck } from './integrity-check';
import { IntegrityCheckRegistry } from './integrity-check.registry';

/**
 * Sweeps every registered data invariant a few times a day and alerts Discord
 * on violations. Runs on the same server and data it checks, so it catches
 * bugs and silent drift - not a compromised server. Single-instance only: see
 * docs/single-instance.md.
 */
@Injectable()
export class IntegrityService {
  private readonly logger = new Logger(IntegrityService.name);

  constructor(
    private readonly registry: IntegrityCheckRegistry,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async runChecks(): Promise<void> {
    for (const check of this.registry.list()) {
      // eslint-disable-next-line no-await-in-loop -- background sweep; sequential keeps database load flat
      await this.runOne(check);
    }
  }

  private async runOne(check: IntegrityCheck): Promise<void> {
    let violations: string[];
    try {
      violations = await check.findViolations();
    } catch (error) {
      this.logger.error(
        `Integrity check failed to run: ${check.name}`,
        error instanceof Error ? error.stack : undefined,
      );
      void this.discordLogger.sendError({
        source: 'cron',
        title: `Integrity check failed to run: ${check.name}`,
        errorName:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        fields: [{ name: 'Check', value: check.name, inline: true }],
        stack: error instanceof Error ? error.stack : undefined,
      });
      return;
    }

    if (violations.length === 0) return;

    void this.discordLogger.sendError({
      source: check.source,
      title: check.title,
      errorName: 'IntegrityViolation',
      dedupKey: `Integrity:${check.name}`,
      fields: [
        {
          name: 'Count (sampled)',
          value: String(violations.length),
          inline: true,
        },
        {
          name: 'Examples',
          value: violations.slice(0, 5).join('\n'),
          inline: false,
        },
      ],
    });
  }
}
