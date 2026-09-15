import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import {
  assertIsCommitForConversation,
  assertIsWelcomeMessage,
} from './mls-handshake-framing.util';
import {
  MlsHandshakesRepository,
  type HandshakeAcceptResult,
} from './mls-handshakes.repository';
import { SubmitHandshakeDto } from './dto/submit-handshake.dto';

interface SerializableHandshake {
  id: string;
  conversationId: string;
  epoch: number;
  senderDeviceId: string;
  payload: Uint8Array;
  createdAt: Date;
}

@Injectable()
export class MlsHandshakesService {
  constructor(
    private readonly mlsHandshakesRepository: MlsHandshakesRepository,
    private readonly chatDevicesService: ChatDevicesService,
  ) {}

  async submitHandshake(
    userId: string,
    conversationId: string,
    dto: SubmitHandshakeDto,
  ) {
    await this.assertActiveParticipant(conversationId, userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, dto.deviceId);

    const payload = new Uint8Array(Buffer.from(dto.payload, 'base64'));
    assertIsCommitForConversation(payload, conversationId);

    const welcomes = dto.welcomes.map((item) => {
      const welcomePayload = new Uint8Array(
        Buffer.from(item.payload, 'base64'),
      );
      assertIsWelcomeMessage(welcomePayload);
      return {
        recipientDeviceId: item.recipientDeviceId,
        payload: welcomePayload,
      };
    });

    const payloadSha256 = createHash('sha256').update(payload).digest('hex');

    const result = await this.mlsHandshakesRepository.acceptHandshake({
      conversationId,
      expectedEpoch: dto.epoch,
      senderDeviceId: dto.deviceId,
      payload,
      payloadSha256,
      welcomes,
    });

    return this.toSubmitResponse(result);
  }

  async getHandshakesSince(
    userId: string,
    conversationId: string,
    sinceEpoch: number,
  ) {
    await this.assertActiveParticipant(conversationId, userId);

    const handshakes = await this.mlsHandshakesRepository.findHandshakesSince(
      conversationId,
      sinceEpoch,
    );

    return handshakes.map((handshake) => this.serializeHandshake(handshake));
  }

  async getPendingWelcomes(userId: string, deviceId: string) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const welcomes =
      await this.mlsHandshakesRepository.findPendingWelcomes(deviceId);

    return welcomes.map((welcome) => ({
      id: welcome.id,
      conversationId: welcome.conversationId,
      payload: Buffer.from(welcome.payload).toString('base64'),
      createdAt: welcome.createdAt,
    }));
  }

  async consumeWelcome(userId: string, deviceId: string, welcomeId: string) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const consumed = await this.mlsHandshakesRepository.markWelcomeConsumed(
      welcomeId,
      deviceId,
    );

    if (!consumed) {
      throw new NotFoundException('Welcome not found or already consumed');
    }

    return { message: 'Welcome consumed' };
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

  private toSubmitResponse(result: HandshakeAcceptResult) {
    if (result.outcome === 'conflict') {
      // 409: the caller's Commit lost the race for this epoch. The body
      // carries the winning handshake so the caller can catch up rather
      // than just being told "try again" with nothing to act on.
      throw new ConflictException({
        message: 'Another commit already won this epoch',
        outcome: 'conflict',
        handshake: this.serializeHandshake(result.handshake),
      });
    }

    return {
      outcome: result.outcome,
      handshake: this.serializeHandshake(result.handshake),
    };
  }

  private serializeHandshake(handshake: SerializableHandshake) {
    return {
      id: handshake.id,
      conversationId: handshake.conversationId,
      epoch: handshake.epoch,
      senderDeviceId: handshake.senderDeviceId,
      payload: Buffer.from(handshake.payload).toString('base64'),
      createdAt: handshake.createdAt,
    };
  }
}
