import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const CONSUMED_WELCOME_RETENTION_MS = 30 * DAY_MS;
export const COMMIT_FAULT_RETENTION_MS = 180 * DAY_MS;
export const CLAIMED_KEY_PACKAGE_RETENTION_MS = 30 * DAY_MS;

export const PRUNE_BATCH_SIZE = 500;
/** Ceiling per rule per run, so a huge backlog drains over several nights instead of one long job. */
const MAX_BATCHES_PER_RULE = 200;

interface PruneRule {
  name: string;
  /** Deletes up to one batch and returns how many rows went. */
  deleteBatch: (now: Date) => Promise<number>;
}

/**
 * Prunes MLS rows nothing will read again. mls_handshakes is deliberately NOT pruned: members
 * catch up by applying every Commit in order, so the log is bounded by retiring dormant devices.
 * mls_group_members is not pruned either: removed rows rebuild the roster for members lagging on old epochs.
 * Expired key packages are purged by MlsKeyPackageCleanupService.
 */
@Injectable()
export class MlsRetentionService {
  private readonly logger = new Logger(MlsRetentionService.name);

  private readonly rules: PruneRule[] = [
    {
      name: 'consumedWelcomes',
      deleteBatch: (now) =>
        this.deleteBatchOf(this.prisma.mlsWelcome, {
          consumedAt: {
            lt: new Date(now.getTime() - CONSUMED_WELCOME_RETENTION_MS),
          },
        }),
    },
    {
      // A revoked device never polls again, so a Welcome waiting for it is dead weight.
      name: 'welcomesOfRevokedDevices',
      deleteBatch: () =>
        this.deleteBatchOf(this.prisma.mlsWelcome, {
          consumedAt: null,
          recipientDevice: { revokedAt: { not: null } },
        }),
    },
    {
      name: 'commitFaults',
      deleteBatch: (now) =>
        this.deleteBatchOf(this.prisma.mlsCommitFault, {
          createdAt: {
            lt: new Date(now.getTime() - COMMIT_FAULT_RETENTION_MS),
          },
        }),
    },
    {
      // Only claimed SINGLE_USE rows: LAST_RESORT is never claimed, expired ones have their own job.
      name: 'claimedKeyPackages',
      deleteBatch: (now) =>
        this.deleteBatchOf(this.prisma.mlsKeyPackage, {
          kind: 'SINGLE_USE',
          claimedAt: {
            lt: new Date(now.getTime() - CLAIMED_KEY_PACKAGE_RETENTION_MS),
          },
        }),
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  /** After the 4am dormant-device retirement, so freshly revoked devices' Welcomes go the same night. */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async pruneMlsTables(): Promise<void> {
    const now = new Date();

    for (const rule of this.rules) {
      try {
        const deleted = await this.runRule(rule, now);

        if (deleted > 0) {
          this.logger.log(`MLS retention ${rule.name}: deleted ${deleted}`);
        }
      } catch (error) {
        this.reportFailure(rule.name, error);
      }
    }
  }

  private async runRule(rule: PruneRule, now: Date): Promise<number> {
    let total = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RULE; batch += 1) {
      const deleted = await rule.deleteBatch(now);
      total += deleted;

      if (deleted < PRUNE_BATCH_SIZE) {
        break;
      }
    }

    return total;
  }

  private async deleteBatchOf<W>(
    delegate: {
      findMany: (args: {
        where: W;
        select: { id: true };
        take: number;
      }) => Promise<Array<{ id: string }>>;
      deleteMany: (args: {
        where: { id: { in: string[] } };
      }) => Promise<{ count: number }>;
    },
    where: W,
  ): Promise<number> {
    const rows = await delegate.findMany({
      where,
      select: { id: true },
      take: PRUNE_BATCH_SIZE,
    });
    const result = await delegate.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return result.count;
  }

  private reportFailure(ruleName: string, error: unknown): void {
    const errorName =
      error instanceof Error ? error.constructor.name : 'UnknownError';

    this.logger.error(
      `MLS retention rule ${ruleName} failed`,
      error instanceof Error ? error.stack : undefined,
    );

    void this.discordLogger.sendError({
      source: 'cron',
      title: 'Cron job failed: pruneMlsTables',
      errorName,
      fields: [
        { name: 'Job', value: 'pruneMlsTables', inline: true },
        { name: 'Rule', value: ruleName, inline: true },
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
