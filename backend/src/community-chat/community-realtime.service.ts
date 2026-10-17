import { Injectable } from '@nestjs/common';
import { SocketRegistry } from '../websocket/socket-registry.service';

export const communityRoom = (channelId: string) => `community:${channelId}`;

/** Tells everyone with a room open that something in it changed; what each person then sees is fetched per person. */
@Injectable()
export class CommunityRealtimeService {
  constructor(private readonly registry: SocketRegistry) {}

  changed(channelId: string): void {
    this.registry.server
      ?.to(communityRoom(channelId))
      .emit('community:activity', { channelId });
  }
}
