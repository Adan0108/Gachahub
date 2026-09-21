import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { DiscordLoggerService } from '../common/discord/discord-logger.service';
import { ReportCommitFaultDto } from './dto/report-commit-fault.dto';
import { MlsHandshakesRepository } from './mls-handshakes.repository';

/**
 * Where a member's client tells the server it refused a Commit. Without this a
 * refused Commit freezes the conversation for every member who checks, with no
 * trace of who sent it or why - a buggy client (not even a malicious one) that
 * declares the wrong membership would do it. Recording it, and alerting, gives
 * whoever looks into it the sender and the reason.
 */
@Injectable()
export class MlsCommitFaultsService {
  constructor(
    private readonly mlsHandshakesRepository: MlsHandshakesRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  async reportFault(
    userId: string,
    conversationId: string,
    dto: ReportCommitFaultDto,
  ) {
    await this.assertActiveParticipant(conversationId, userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, dto.deviceId);

    // Only a Commit that exists can be reported, which also bounds how many
    // distinct faults one member can file.
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

    // Filing the same fault again (every poll re-detects it) must not re-alert.
    if (isNew) {
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
          { name: 'Reason', value: dto.reason, inline: false },
        ],
        dedupKey: `MlsCommitRefused:${conversationId}:${dto.epoch}`,
      });
    }

    return { recorded: isNew };
  }

  private async assertActiveParticipant(
    conversationId: string,
    userId: string,
  ) {
    const isParticipant =
      await this.mlsHandshakesRepository.isActiveParticipant(
        conversationId,
        userId,
      );

    if (!isParticipant) {
      throw new ForbiddenException(
        'Not an active participant in this conversation',
      );
    }
  }
}
