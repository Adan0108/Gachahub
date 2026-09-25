import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DiscordLoggerService } from '../../common/discord/discord-logger.service';
import { ChatMembershipRepository } from './chat-membership.repository';
import { ChatMembershipService } from './chat-membership.service';

/** An invite (group or DM) unanswered this long expires on its own. */
const EXPIRE_PENDING_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

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
      const cutoff = new Date(Date.now() - EXPIRE_PENDING_AFTER_MS);
      const userIdsByConversationId =
        await this.chatMembershipRepository.findExpiredPendingInvites(cutoff);

      let expiredCount = 0;
      let failedConversationCount = 0;

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
          // Someone answering between the read above and this running is not an
          // error - expireInvites skips them person by person. This is a real
          // failure (a database error, or a concurrent change that made the
          // conversation's write conflict), isolated per conversation so it doesn't
          // stop the rest of the sweep, and retried on tomorrow's run.
          failedConversationCount += 1;
          this.logger.warn(
            `Failed to expire invites for conversation ${conversationId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
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
