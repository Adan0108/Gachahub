import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../../common/discord/discord-logger.service';
import { ChatMembershipRepository } from './chat-membership.repository';
import { ChatMembershipService } from './chat-membership.service';

/** An invite (group or DM) unanswered this long expires on its own. */
const EXPIRE_PENDING_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const EXPIRE_BATCH_SIZE = 500;
const MAX_EXPIRE_BATCHES = 100;

/**
 * Expires invites nobody ever answered. PENDING became entitled to an MLS leaf
 * (leaf-entitlement.ts) so a group invitee's device is added and starts receiving
 * epoch secrets immediately, before they ever accept - without this, an ignored
 * invite would be permanent cryptographic membership: the invitee's device would
 * keep receiving every future epoch secret forever, having never agreed to
 * anything. Routes through the ordinary EXPIRE_INVITE -> LEAVING pipeline, the same
 * membership machinery a decline or an admin removal uses, not a bespoke path -
 * mirrors MlsKeyPackageCleanupService's cron + Discord-on-failure shape.
 */
@Injectable()
export class ChatInviteExpiryService {
  private readonly logger = new Logger(ChatInviteExpiryService.name);

  constructor(
    private readonly chatMembershipRepository: ChatMembershipRepository,
    private readonly chatMembershipService: ChatMembershipService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async expireStaleInvites(): Promise<void> {
    try {
      const now = Date.now();
      await this.chatMembershipRepository.stampMissingPendingSince(
        new Date(now),
      );
      const cutoff = new Date(now - EXPIRE_PENDING_AFTER_MS);
      let expiredCount = 0;
      let failedConversationCount = 0;

      for (let batch = 0; batch < MAX_EXPIRE_BATCHES; batch += 1) {
        const userIdsByConversationId =
          await this.chatMembershipRepository.findExpiredPendingInvites(
            cutoff,
            EXPIRE_BATCH_SIZE,
          );
        const batchSize = [...userIdsByConversationId.values()].reduce(
          (sum, userIds) => sum + userIds.length,
          0,
        );
        const expiredBefore = expiredCount;

        for (const [
          conversationId,
          userIds,
        ] of userIdsByConversationId.entries()) {
          try {
            const { count } = await this.chatMembershipService.expireInvites(
              conversationId,
              userIds,
            );
            expiredCount += count;
          } catch (error) {
            // A real failure (db error or write conflict); isolated per conversation, retried tomorrow.
            failedConversationCount += 1;
            this.logger.warn(
              `Failed to expire invites for conversation ${conversationId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        // Short batch = drained; zero progress = stuck rows that would refetch forever.
        if (batchSize < EXPIRE_BATCH_SIZE || expiredCount === expiredBefore) {
          break;
        }
      }

      if (expiredCount > 0) {
        this.logger.log(`Expired ${expiredCount} unanswered chat invites`);
      }

      if (failedConversationCount > 0) {
        void this.discordLogger.sendError({
          source: 'cron',
          title: 'Cron job partially failed: expireStaleInvites',
          errorName: 'ChatInviteExpirySweepPartialFailure',
          fields: [
            { name: 'Job', value: 'expireStaleInvites', inline: true },
            {
              name: 'Conversations failed',
              value: String(failedConversationCount),
              inline: true,
            },
            {
              name: 'Invites expired',
              value: String(expiredCount),
              inline: true,
            },
          ],
        });
      }
    } catch (error) {
      const errorName =
        error instanceof Error ? error.constructor.name : 'UnknownError';

      this.logger.error(
        'Invite expiry job failed',
        error instanceof Error ? error.stack : undefined,
      );

      void this.discordLogger.sendError({
        source: 'cron',
        title: 'Cron job failed: expireStaleInvites',
        errorName,
        fields: [
          { name: 'Job', value: 'expireStaleInvites', inline: true },
          { name: 'Error', value: errorName, inline: true },
        ],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
