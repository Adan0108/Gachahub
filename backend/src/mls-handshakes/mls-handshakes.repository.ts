import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface HandshakeRow {
  id: string;
  conversationId: string;
  epoch: number;
  senderDeviceId: string;
  payload: Uint8Array;
  payloadSha256: string;
  createdAt: Date;
}

export type HandshakeAcceptResult =
  | { outcome: 'accepted'; handshake: HandshakeRow }
  | { outcome: 'duplicate'; handshake: HandshakeRow }
  | { outcome: 'conflict'; handshake: HandshakeRow };

@Injectable()
export class MlsHandshakesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ChatModule exports nothing today, and importing it here would risk a
   * circular dependency once stage 5 has it call into MlsHandshakesService -
   * so this duplicates a trivial lookup instead, matching existing
   * precedent (chat-devices.repository.ts already queries `user` directly
   * for the same reason).
   */
  async isActiveParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });

    return participant?.state === 'ACTIVE';
  }

  /**
   * Atomic compare-and-set: mlsEpoch only advances when expectedEpoch still
   * matches, so exactly one Commit ever wins a given epoch. A loser gets
   * back whatever handshake DID win, so it can tell a harmless retry (same
   * payload) from a real conflict (someone else's Commit) it must catch up
   * on - the server never resolves crypto conflicts itself, only ordering.
   *
   * The epoch bump, the membership sync (below), and the handshake/welcome
   * rows all happen in one transaction (threat-model §3: "the two must be
   * kept in sync in the same transaction") - if a welcome targets a user the
   * server never authorized into this conversation, the whole commit is
   * rejected and rolled back, including the epoch bump, rather than leaving
   * an epoch advanced with no matching handshake row.
   */
  async acceptHandshake(params: {
    conversationId: string;
    expectedEpoch: number;
    senderDeviceId: string;
    payload: Uint8Array;
    payloadSha256: string;
    welcomes: { recipientDeviceId: string; payload: Uint8Array }[];
  }): Promise<HandshakeAcceptResult> {
    const {
      conversationId,
      expectedEpoch,
      senderDeviceId,
      payload,
      payloadSha256,
      welcomes,
    } = params;

    const accepted = await this.prisma.$transaction(async (tx) => {
      const advanced = await tx.chatConversation.updateMany({
        where: { id: conversationId, mlsEpoch: expectedEpoch },
        data: { mlsEpoch: { increment: 1 } },
      });

      if (advanced.count === 0) {
        return null;
      }

      for (const welcome of welcomes) {
        await this.assertWelcomedIntoAuthorizedConversation(
          tx,
          conversationId,
          welcome.recipientDeviceId,
        );
      }

      const handshake = await tx.mlsHandshake.create({
        data: {
          conversationId,
          epoch: expectedEpoch,
          senderDeviceId,
          payload: payload.slice(),
          payloadSha256,
        },
      });

      if (welcomes.length > 0) {
        await tx.mlsWelcome.createMany({
          data: welcomes.map((welcome) => ({
            conversationId,
            recipientDeviceId: welcome.recipientDeviceId,
            payload: welcome.payload.slice(),
          })),
        });
      }

      return handshake;
    });

    if (accepted) {
      return { outcome: 'accepted', handshake: accepted };
    }

    const winner = await this.prisma.mlsHandshake.findUnique({
      where: { conversationId_epoch: { conversationId, epoch: expectedEpoch } },
    });

    if (!winner) {
      // Only reachable if conversationId itself vanished mid-request -
      // callers check participation (and therefore existence) beforehand.
      throw new Error(
        `No handshake found for conversation ${conversationId} at epoch ${expectedEpoch}`,
      );
    }

    return {
      outcome:
        winner.payloadSha256 === payloadSha256 ? 'duplicate' : 'conflict',
      handshake: winner,
    };
  }

  /**
   * MLS Add is only ever the cryptographic side effect of a membership
   * decision the server already authorized elsewhere - mutual-follow/
   * message-request checks (chat.service.ts) or an explicit acceptRequest
   * (threat-model §3). This never CREATES or flips participant state; it
   * only asserts the state that decision already produced is ACTIVE, so an
   * MLS commit can never be the thing that first grants conversation
   * membership.
   */
  private async assertWelcomedIntoAuthorizedConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
    recipientDeviceId: string,
  ): Promise<void> {
    const device = await tx.chatDevice.findUnique({
      where: { id: recipientDeviceId },
      select: { userId: true },
    });

    if (!device) {
      throw new BadRequestException(
        `Unknown recipient device: ${recipientDeviceId}`,
      );
    }

    const participant = await tx.chatParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: device.userId },
      },
    });

    if (!participant || participant.state !== 'ACTIVE') {
      throw new ForbiddenException(
        `User ${device.userId} is not an active participant of this conversation`,
      );
    }
  }

  findHandshakesSince(conversationId: string, fromEpoch: number) {
    return this.prisma.mlsHandshake.findMany({
      where: { conversationId, epoch: { gte: fromEpoch } },
      orderBy: { epoch: 'asc' },
    });
  }

  findPendingWelcomes(recipientDeviceId: string) {
    return this.prisma.mlsWelcome.findMany({
      where: { recipientDeviceId, consumedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markWelcomeConsumed(
    welcomeId: string,
    recipientDeviceId: string,
  ): Promise<boolean> {
    const result = await this.prisma.mlsWelcome.updateMany({
      where: { id: welcomeId, recipientDeviceId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    return result.count === 1;
  }
}
