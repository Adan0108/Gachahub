import { Injectable } from '@nestjs/common';
import type { ChatParticipantState } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The one read of "what is this user's state in this conversation", shared by the device and handshake modules. */
@Injectable()
export class ParticipantStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The state of each of these users in the conversation; users with no row are absent. */
  async findStates(
    conversationId: string,
    userIds: string[],
  ): Promise<Map<string, ChatParticipantState>> {
    const participants = await this.prisma.chatParticipant.findMany({
      where: { conversationId, userId: { in: userIds } },
      select: { userId: true, state: true },
    });

    return new Map(
      participants.map((participant) => [
        participant.userId,
        participant.state,
      ]),
    );
  }

  /** One user's state, undefined when they have no participant row. */
  async findState(
    conversationId: string,
    userId: string,
  ): Promise<ChatParticipantState | undefined> {
    return (await this.findStates(conversationId, [userId])).get(userId);
  }
}
