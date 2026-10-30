import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatRepository } from './chat.repository';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

/**
 * Tells everyone in a group, live, that its details changed (name, photo, members, roles), so
 * their open chat list and member panel refetch instead of showing the old state until a reload.
 */
@Injectable()
export class GroupChangeNotifier {
  private readonly logger = new Logger(GroupChangeNotifier.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  /** Runs `change`, then announces it; the change's own result comes back unchanged. */
  async after<T>(conversationId: string, change: () => Promise<T>): Promise<T> {
    const result = await change();
    await this.announce(conversationId);
    return result;
  }

  // Best effort: the change is saved, and the 15 second inbox refetch catches up anyone missed.
  private async announce(conversationId: string) {
    try {
      const conversation =
        await this.chatRepository.findConversationWithParticipants(
          conversationId,
        );
      if (!conversation) return;
      await this.chatDelivery.publishConversationUpdated({
        conversationId,
        // People who left or were removed too, so their list drops the group.
        recipientUserIds: conversation.participants.map(
          (participant) => participant.userId,
        ),
      });
    } catch (error) {
      this.logger.warn(
        `Could not announce a change to group ${conversationId}`,
        error,
      );
    }
  }
}
