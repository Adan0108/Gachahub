import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import {
  MlsAuditRepository,
  type StuckParticipant,
  type SuspectLeaf,
} from './mls-audit.repository';

/**
 * Watchdog for the MLS state: every few hours it looks for things that should
 * never be true - a device in a group's encryption whose owner is not in the
 * conversation, a dead device still in a group, a join or removal stuck for a
 * day - and alerts Discord. Catches bugs, and a server-side tamper, that no
 * single request would surface.
 */
@Injectable()
export class MlsAuditService {
  private readonly logger = new Logger(MlsAuditService.name);

  constructor(
    private readonly auditRepository: MlsAuditRepository,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async auditGroups(): Promise<void> {
    try {
      const [deadDevices, outsiders, stuck] = await Promise.all([
        this.auditRepository.findLeavesOfDeadDevices(),
        this.auditRepository.findLeavesOfOutsiders(),
        this.auditRepository.findStuckParticipants(),
      ]);

      this.alertLeaves(
        'A retired or deleted device is still in a group encryption',
        'MlsAudit:dead-device',
        deadDevices,
      );
      this.alertLeaves(
        'A device is in a group encryption although its owner is not in the conversation',
        'MlsAudit:outsider',
        outsiders,
      );
      this.alertStuck(stuck);
    } catch (error) {
      this.logger.error(
        'MLS audit job failed',
        error instanceof Error ? error.stack : undefined,
      );
      void this.discordLogger.sendError({
        source: 'cron',
        title: 'Cron job failed: auditGroups',
        errorName:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        fields: [{ name: 'Job', value: 'auditGroups', inline: true }],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private alertLeaves(
    title: string,
    dedupKey: string,
    leaves: SuspectLeaf[],
  ): void {
    if (leaves.length === 0) return;

    void this.discordLogger.sendError({
      source: 'mls',
      title,
      errorName: 'MlsAuditFinding',
      dedupKey,
      fields: [
        { name: 'Count (sampled)', value: String(leaves.length), inline: true },
        {
          name: 'Examples',
          value: leaves
            .slice(0, 5)
            .map(
              (leaf) =>
                `${leaf.conversationId} / ${leaf.userId} / ${leaf.deviceId}`,
            )
            .join('\n'),
          inline: false,
        },
      ],
    });
  }

  private alertStuck(stuck: StuckParticipant[]): void {
    if (stuck.length === 0) return;

    void this.discordLogger.sendError({
      source: 'mls',
      title: 'Joins or removals stuck for over a day',
      errorName: 'MlsAuditFinding',
      dedupKey: 'MlsAudit:stuck',
      fields: [
        { name: 'Count (sampled)', value: String(stuck.length), inline: true },
        {
          name: 'Examples',
          value: stuck
            .slice(0, 5)
            .map(
              (row) => `${row.conversationId} / ${row.userId} (${row.state})`,
            )
            .join('\n'),
          inline: false,
        },
      ],
    });
  }
}
