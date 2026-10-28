import { Injectable } from '@nestjs/common';
import { SocketRegistry } from '../websocket/socket-registry.service';

export const communityRoom = (channelId: string) => `community:${channelId}`;

/** Tells everyone with a room open that something in it changed; what each person then sees is fetched per person. */
@Injectable()
export class CommunityRealtimeService {
  constructor(private readonly registry: SocketRegistry) {}

  /** `messageId` is the message that was sent, edited, removed or reacted to, so listeners fetch just that one. */
  changed(channelId: string, messageId?: string): void {
    this.registry.server
      ?.to(communityRoom(channelId))
      .emit('community:activity', { channelId, messageId });
  }
}
