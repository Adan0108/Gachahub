import { Injectable } from '@nestjs/common';
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

    const advanced = await this.prisma.chatConversation.updateMany({
      where: { id: conversationId, mlsEpoch: expectedEpoch },
      data: { mlsEpoch: { increment: 1 } },
    });

    if (advanced.count === 1) {
      const handshake = await this.prisma.$transaction(async (tx) => {
        const created = await tx.mlsHandshake.create({
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

        return created;
      });

      return { outcome: 'accepted', handshake };
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
