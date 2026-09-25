import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { isEntitledToLeaf } from '../chat/membership/leaf-entitlement';
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
import { ExternalJoinDto } from './dto/external-join.dto';
import {
  assertGroupInfoSignedBy,
  assertIsGroupInfoFor,
} from './mls-group-info.util';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import { MlsSelfJoinRateLimiterService } from './mls-self-join-rate-limiter.service';
import {
  assertExternalJoinSigned,
  assertJoinerMatchesDevice,
  readExternalJoin,
} from './mls-external-commit.util';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import { ParticipantStateRepository } from '../mls-group-roster/participant-state.repository';
import { assertDeclarationIsConsistent } from './mls-membership-rules';

/** A full page means there may be more; the client asks again. */
export const HANDSHAKES_PER_PAGE = 100;
export const WELCOMES_PER_PAGE = 50;

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
  private readonly logger = new Logger(MlsHandshakesService.name);

  constructor(
    private readonly mlsHandshakesRepository: MlsHandshakesRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly selfJoinRateLimiter: MlsSelfJoinRateLimiterService,
    private readonly groupInfoRepository: MlsGroupInfoRepository,
    private readonly requestRateLimiter: MlsRequestRateLimiterService,
    private readonly participantStates: ParticipantStateRepository,
  ) {}

  async submitHandshake(
    userId: string,
    conversationId: string,
    dto: SubmitHandshakeDto,
  ) {
    this.requestRateLimiter.assertMaySubmitHandshake(userId);
    await this.assertActiveParticipant(conversationId, userId);
    const device = await this.chatDevicesService.assertOwnActiveDevice(
      userId,
      dto.deviceId,
    );

    const payload = new Uint8Array(Buffer.from(dto.payload, 'base64'));
    assertIsCommitForConversation(payload, conversationId, dto.epoch);

    const welcomes = this.fanOutWelcome(dto.welcome);

    assertDeclarationIsConsistent({
      senderDeviceId: dto.deviceId,
      addedDeviceIds: dto.addedDeviceIds,
      removedDeviceIds: dto.removedDeviceIds,
      welcomeRecipientDeviceIds: welcomes.map((item) => item.recipientDeviceId),
    });

    const payloadSha256 = createHash('sha256').update(payload).digest('hex');

    const groupInfo = await this.decodeGroupInfo(
      dto.groupInfo,
      conversationId,
      dto.epoch,
      device.signaturePublicKey,
    );

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
      groupInfo,
    });

    return this.toSubmitResponse(result);
  }

  /** One Welcome for all new members becomes one row per recipient device. */
  private fanOutWelcome(welcome: SubmitHandshakeDto['welcome']) {
    if (!welcome) {
      return [];
    }
    const payload = new Uint8Array(Buffer.from(welcome.payload, 'base64'));
    assertIsWelcomeMessage(payload);
    return welcome.recipientDeviceIds.map((recipientDeviceId) => ({
      recipientDeviceId,
      payload,
    }));
  }

  /**
   * A device adds itself to the group with no member online. The server sees the
   * whole commit (it is public), and accepts only a plain join by the caller's
   * own registered device; every member then checks it like any other add.
   */
  async submitExternalJoin(
    userId: string,
    conversationId: string,
    dto: ExternalJoinDto,
  ) {
    this.selfJoinRateLimiter.assertMayJoin(userId);
    // First, so a stranger or removed member learns nothing about epochs, snapshots or winning Commits.
    await this.assertEntitledParticipant(conversationId, userId);
    const device = await this.chatDevicesService.assertOwnActiveDevice(
      userId,
      dto.deviceId,
    );

    const payload = new Uint8Array(Buffer.from(dto.payload, 'base64'));
    assertJoinerMatchesDevice(
      readExternalJoin(payload, conversationId, dto.epoch),
      {
        userId,
        deviceId: dto.deviceId,
        signaturePublicKey: device.signaturePublicKey,
      },
    );

    // Only the live frontier needs a fresh signature check: a forged commit can only mutate state there -
    // the epoch compare-and-set below refuses anything targeting an epoch that already settled. Resubmitting
    // THIS device's own already-accepted join (recovering from a crash between accept and save) lands here
    // too, with the exact same bytes; acceptExternalJoin's own duplicate-vs-conflict check (identical to the
    // one every ordinary Commit resubmission already relies on) is what tells that apart from a real race.
    const currentEpoch =
      await this.mlsHandshakesRepository.getCurrentEpoch(conversationId);
    if (currentEpoch === null) {
      throw new NotFoundException('Conversation not found');
    }
    if (currentEpoch === dto.epoch) {
      // The signature is checked against the server's OWN stored snapshot for that epoch, never the caller's bytes.
      const snapshot =
        await this.groupInfoRepository.findCurrent(conversationId);
      if (!snapshot || snapshot.epoch !== dto.epoch) {
        throw new ConflictException(
          'The group moved on - fetch a fresh snapshot and rejoin',
        );
      }
      await assertExternalJoinSigned(
        payload,
        snapshot.payload,
        device.signaturePublicKey,
      );
    }

    const groupInfo = await this.decodeGroupInfo(
      dto.groupInfo,
      conversationId,
      dto.epoch,
      device.signaturePublicKey,
    );

    const result = await this.mlsHandshakesRepository.acceptExternalJoin({
      conversationId,
      expectedEpoch: dto.epoch,
      deviceId: dto.deviceId,
      userId,
      payload,
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      groupInfo,
    });

    return this.toSubmitResponse(result);
  }

  /** The snapshot a Commit publishes for the epoch it creates, checked to be exactly that; undefined when none was sent or it is not attributable. */
  private async decodeGroupInfo(
    encoded: string | undefined,
    conversationId: string,
    commitEpoch: number,
    publisherSignatureKey: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    if (!encoded) {
      return undefined;
    }
    const groupInfo = new Uint8Array(Buffer.from(encoded, 'base64'));
    assertIsGroupInfoFor(groupInfo, conversationId, commitEpoch + 1);
    try {
      await assertGroupInfoSignedBy(groupInfo, publisherSignatureKey);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      // Not stored (the response says so), but the Commit itself still flows.
      this.logger.warn(
        `Dropped unattributable GroupInfo for ${conversationId}: ${error.message}`,
      );
      return undefined;
    }
    return groupInfo;
  }

  async getHandshakesSince(
    userId: string,
    conversationId: string,
    sinceEpoch: number,
  ) {
    await this.assertEntitledParticipant(conversationId, userId);

    const handshakes = await this.mlsHandshakesRepository.findHandshakesSince(
      conversationId,
      sinceEpoch,
      HANDSHAKES_PER_PAGE,
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
    this.requestRateLimiter.assertMayFetchRoster(userId);
    await this.assertEntitledParticipant(conversationId, userId);

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

  /** Oldest first; `after` (the last welcome id seen) skips ones a client cannot consume so they never starve newer ones. */
  async getPendingWelcomes(userId: string, deviceId: string, after?: string) {
    this.requestRateLimiter.assertMayPollPending(userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const welcomes = await this.mlsHandshakesRepository.findPendingWelcomes(
      deviceId,
      WELCOMES_PER_PAGE,
      after,
    );
    if (!welcomes) {
      throw new BadRequestException(
        'Unknown welcome cursor; start again without it',
      );
    }

    return welcomes.map((welcome) => ({
      id: welcome.id,
      conversationId: welcome.conversationId,
      payload: Buffer.from(welcome.payload).toString('base64'),
      createdAt: welcome.createdAt,
    }));
  }

  async consumeWelcome(userId: string, deviceId: string, welcomeId: string) {
    this.requestRateLimiter.assertMayPollPending(userId);
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

  private async assertEntitledParticipant(
    conversationId: string,
    userId: string,
  ) {
    const state = await this.participantStates.findState(
      conversationId,
      userId,
    );

    if (!isEntitledToLeaf(state)) {
      throw new ForbiddenException('Not a member of this conversation');
    }
  }

  private async assertActiveParticipant(
    conversationId: string,
    userId: string,
  ) {
    const state = await this.participantStates.findState(
      conversationId,
      userId,
    );

    if (state !== 'ACTIVE') {
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
