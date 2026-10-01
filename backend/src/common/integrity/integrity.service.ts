import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../discord/discord-logger.service';
import type { IntegrityCheck } from './integrity-check';
import { IntegrityCheckRegistry } from './integrity-check.registry';

/** One slow or hung check must not delay every check after it in the same sweep. */
const CHECK_TIMEOUT_MS = 30_000;

/**
 * Sweeps every registered data invariant a few times a day and alerts Discord
 * on violations. Runs on the same server and data it checks, so it catches
 * bugs and silent drift - not a compromised server. Single-instance only: see
 * docs/single-instance.md.
 */
@Injectable()
export class IntegrityService {
  private readonly logger = new Logger(IntegrityService.name);

  private sweeping = false;

  constructor(
    private readonly registry: IntegrityCheckRegistry,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async runChecks(): Promise<void> {
    // @nestjs/schedule does not stop one Cron firing from overlapping the last: with the per-check
    // timeout below this should never happen, but skip rather than run two sweeps at once if it does.
    if (this.sweeping) return;
    this.sweeping = true;

    try {
      for (const check of this.registry.list()) {
        // eslint-disable-next-line no-await-in-loop -- background sweep; sequential keeps database load flat
        await this.runOne(check);
      }
    } finally {
      this.sweeping = false;
    }
  }

  private withTimeout(check: IntegrityCheck): Promise<string[]> {
    return Promise.race([
      check.findViolations(),
      new Promise<string[]>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  }

  private async runOne(check: IntegrityCheck): Promise<void> {
    let violations: string[];
    try {
      violations = await this.withTimeout(check);
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
