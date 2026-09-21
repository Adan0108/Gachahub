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
import { assertDeclarationIsConsistent } from './mls-membership-rules';

interface SerializableHandshake {
  id: string;
  conversationId: string;
  epoch: number;
  /** Null once the sending device (and its owning account) has been deleted - the Commit itself is kept regardless (see schema.prisma's MlsHandshake.senderDeviceId doc). */
  senderDeviceId: string | null;
  payload: Uint8Array;
  /** False for Commits from before membership was tracked, which carry nothing to check. */
  membershipDeclared: boolean;
  /** Whose device each added leaf must be and which key it must carry - the server's records, not the sender's word. */
  addedDevices: unknown;
  removedDevices: unknown;
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
    assertIsCommitForConversation(payload, conversationId, dto.epoch);

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

    assertDeclarationIsConsistent({
      senderDeviceId: dto.deviceId,
      addedDeviceIds: dto.addedDeviceIds,
      removedDeviceIds: dto.removedDeviceIds,
      welcomeRecipientDeviceIds: welcomes.map((item) => item.recipientDeviceId),
    });

    const payloadSha256 = createHash('sha256').update(payload).digest('hex');

    const result = await this.mlsHandshakesRepository.acceptHandshake({
      conversationId,
      expectedEpoch: dto.epoch,
      senderDeviceId: dto.deviceId,
      senderUserId: userId,
      payload,
      payloadSha256,
      addedDeviceIds: dto.addedDeviceIds,
      removedDeviceIds: dto.removedDeviceIds,
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

  /**
   * Who is in the group at `epoch`, by the server's records. A member checks
   * its whole ratchet tree against this after joining and after every Commit:
   * the per-Commit attestation only proves the tree stayed honest if it started
   * honest, and nothing else vouches for the leaves the group was created with.
   */
  async getRosterAtEpoch(
    userId: string,
    conversationId: string,
    epoch: number,
  ) {
    await this.assertActiveParticipant(conversationId, userId);

    const leaves = await this.mlsHandshakesRepository.findRosterAtEpoch(
      conversationId,
      epoch,
    );

    return {
      epoch,
      leaves: leaves.map((leaf) => ({
        deviceId: leaf.deviceId,
        userId: leaf.userId,
        signaturePublicKey: leaf.signaturePublicKey
          ? Buffer.from(leaf.signaturePublicKey).toString('base64')
          : null,
      })),
    };
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
      // Every member checks these against what the Commit actually did.
      membershipDeclared: handshake.membershipDeclared,
      addedDevices: handshake.addedDevices,
      removedDevices: handshake.removedDevices,
      createdAt: handshake.createdAt,
    };
  }
}
