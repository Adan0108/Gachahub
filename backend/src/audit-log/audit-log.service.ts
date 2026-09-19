import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditEntry } from './audit-log.types';

/**
 * Write side of the audit log: services call record() once their moderation
 * action has succeeded. Reading lives in AuditLogQueryService so this module
 * stays free of GameModeratorsModule, which itself records entries.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  /**
   * Best-effort: the moderation action has already committed by the time this
   * runs, so a failed audit write must not turn a successful action into a
   * 500 the moderator would retry. It does page Discord though - a missing
   * trail has no other signal, since the request itself looks fine.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogRepository.create(entry);
    } catch (error) {
      this.reportFailure(entry, error, 'Audit entry lost');
    }
  }

  /**
   * All-or-nothing variant for entries that must never be lost (privilege
   * changes): joins the caller's transaction and rethrows on failure, rolling
   * back the audited change with it. Alerts first so the operator sees an
   * audit failure, not just a generic 500 from the caller.
   */
  async recordOrThrow(
    entry: AuditEntry,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await this.auditLogRepository.create(entry, tx);
    } catch (error) {
      this.reportFailure(
        entry,
        error,
        'Change rolled back, audit write failed',
      );
      throw error;
    }
  }

  private reportFailure(entry: AuditEntry, error: unknown, title: string) {
    const stack = error instanceof Error ? error.stack : String(error);
    const target = `${entry.targetType}:${entry.targetId}`;

    this.logger.error(
      `${title}: ${entry.action} on ${target} by ${entry.actorId}`,
      stack,
    );

    // Keyed per entry so an outage still names every entry lost, not just the first.
    void this.discordLogger.sendError({
      source: 'audit',
      title: `${title}: ${entry.action}`,
      errorName: 'AuditWriteFailed',
      fields: [
        { name: 'Action', value: entry.action, inline: true },
        { name: 'Actor', value: entry.actorId, inline: true },
        { name: 'Target', value: target, inline: false },
      ],
      stack,
      dedupKey: `AuditWriteFailed:${entry.action}:${target}`,
    });
  }
}
