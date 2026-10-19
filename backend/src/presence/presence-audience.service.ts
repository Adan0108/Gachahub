import { Injectable } from '@nestjs/common';
import { BlocksService } from '../blocks/blocks.service';
import { ChatAccessService } from '../chat/chat-access.service';
import { PRESENCE_AUDIENCE_LIMIT } from './presence.constants';

/** Who may see whose presence: people in an accepted chat together, with no block either way. */
@Injectable()
export class PresenceAudienceService {
  constructor(
    private readonly chatAccess: ChatAccessService,
    private readonly blocks: BlocksService,
  ) {}

  /** The people who share an accepted chat with this person and are not blocked from them either way. */
  async findAudienceIds(userId: string): Promise<string[]> {
    return this.withoutBlocks(userId, await this.findPartnerIds(userId));
  }

  /** Of these people, the ones this viewer may see presence for. */
  async findVisibleAmong(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();

    const partners = await this.findPartnerIds(viewerId, candidateIds);
    return new Set(await this.withoutBlocks(viewerId, partners));
  }

  private findPartnerIds(userId: string, among?: string[]): Promise<string[]> {
    return this.chatAccess.findAcceptedChatPartnerIds(userId, {
      limit: PRESENCE_AUDIENCE_LIMIT,
      among,
    });
  }

  private async withoutBlocks(
    userId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];

    const blocked = await this.blocks.getMutuallyBlockedIdsAmong(
      userId,
      candidateIds,
    );
    return candidateIds.filter((id) => !blocked.has(id));
  }
}
