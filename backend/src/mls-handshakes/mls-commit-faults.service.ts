import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isMemberState } from '../chat/membership/leaf-entitlement';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { ReportCommitFaultDto } from './dto/report-commit-fault.dto';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import { MlsFaultReportRateLimiterService } from './mls-fault-report-rate-limiter.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import { ParticipantStateRepository } from '../mls-group-roster/participant-state.repository';

/** Records a member client's report that it refused a Commit, and alerts. */
@Injectable()
export class MlsCommitFaultsService {
  constructor(
    private readonly mlsHandshakesRepository: MlsHandshakesRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly groupInfoRepository: MlsGroupInfoRepository,
    private readonly rosterRepository: MlsGroupRosterRepository,
    private readonly rateLimiter: MlsFaultReportRateLimiterService,
    private readonly participantStates: ParticipantStateRepository,
  ) {}

  async reportFault(
    userId: string,
    conversationId: string,
    dto: ReportCommitFaultDto,
  ) {
    this.rateLimiter.assertMayReport(userId);
    await this.assertMember(conversationId, userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, dto.deviceId);
    await this.assertDeviceIsInGroup(conversationId, userId, dto.deviceId);

    // Only an existing Commit can be reported.
    const handshake = await this.mlsHandshakesRepository.findHandshakeByEpoch(
      conversationId,
      dto.epoch,
    );
    if (!handshake) {
      throw new NotFoundException('No Commit was accepted at that epoch');
    }

    const isNew = await this.mlsHandshakesRepository.recordCommitFault({
      conversationId,
      epoch: dto.epoch,
      senderDeviceId: handshake.senderDeviceId,
      reporterDeviceId: dto.deviceId,
      reason: dto.reason,
    });

    // A repeat report (every poll re-detects it) must not re-alert.
    if (isNew) {
      await this.discardFaultedSnapshot(conversationId, dto.epoch + 1);

      void this.discordLogger.sendError({
        source: 'mls',
        title: 'A member refused an MLS commit',
        errorName: 'MlsCommitRefused',
        fields: [
          { name: 'Conversation', value: conversationId, inline: true },
          { name: 'Epoch', value: String(dto.epoch), inline: true },
          {
            name: 'Sender device',
            value: handshake.senderDeviceId ?? 'deleted',
            inline: true,
          },
          { name: 'Reason', value: asInlineCode(dto.reason), inline: false },
        ],
        dedupKey: `MlsCommitRefused:${conversationId}:${dto.epoch}`,
      });
    }

    return { recorded: isNew };
  }

  /** Deleting is budgeted per conversation so reports cannot keep the snapshot off; only a real deletion spends budget. */
  private async discardFaultedSnapshot(conversationId: string, epoch: number) {
    if (
      !(await this.groupInfoRepository.describesEpoch(conversationId, epoch))
    ) {
      return;
    }

    if (this.rateLimiter.tryConsumeSnapshotDeletion(conversationId)) {
      await this.groupInfoRepository.deleteIfDescribesEpoch(
        conversationId,
        epoch,
      );
    }
  }

  /** An invitee may read the group but has no leaf, so their word about a Commit means nothing. */
  private async assertMember(conversationId: string, userId: string) {
    const state = await this.participantStates.findState(
      conversationId,
      userId,
    );

    if (!isMemberState(state)) {
      throw new ForbiddenException('Not a member of this conversation');
    }
  }

  private async assertDeviceIsInGroup(
    conversationId: string,
    userId: string,
    deviceId: string,
  ) {
    const leaves = await this.rosterRepository.findActiveLeaves(conversationId);

    if (
      !leaves.some(
        (leaf) => leaf.deviceId === deviceId && leaf.userId === userId,
      )
    ) {
      throw new ForbiddenException('This device is not in the group');
    }
  }
}

/** The reason is a member's own text: shown as code so links and mentions in it stay inert. */
function asInlineCode(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\s+/g, ' ')}\``;
}
