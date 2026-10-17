import { BadRequestException, Injectable } from '@nestjs/common';
import { userRoom } from '../websocket/socket.util';
import { SocketRegistry } from '../websocket/socket-registry.service';
import type { SetPresenceDto } from './dto/set-presence.dto';
import {
  INVISIBLE_DURATIONS_MS,
  type MyPresenceStatus,
  type PublicPresence,
} from './presence.constants';
import { PresenceRepository } from './presence.repository';
import { PresenceStore, isInvisible } from './presence.store';

export interface MyPresence {
  status: MyPresenceStatus;
  /** When the invisibility ends, or null when it has no end (or when online). */
  until: string | null;
}

/** Who is online: a live connection that is not hidden, shown only to people in an accepted chat with them. */
@Injectable()
export class PresenceService {
  constructor(
    private readonly store: PresenceStore,
    private readonly repository: PresenceRepository,
    private readonly registry: SocketRegistry,
  ) {}

  async getMine(userId: string): Promise<MyPresence> {
    const preference = await this.store.getInvisible(userId);
    if (!preference || !isInvisible(preference, Date.now())) {
      return { status: 'ONLINE', until: null };
    }

    return {
      status: 'INVISIBLE',
      until:
        preference.until === null
          ? null
          : new Date(preference.until).toISOString(),
    };
  }

  /** Presence of the requested people as this viewer may see it; anyone they may not see reads as offline. */
  async getVisible(
    viewerId: string,
    userIds: string[],
  ): Promise<Record<string, PublicPresence>> {
    const now = Date.now();
    const visible = await this.repository.findVisibleAmong(viewerId, userIds);
    const ids = userIds.filter((id) => visible.has(id));
    const [connected, invisible] = await Promise.all([
      this.store.connectedAmong(ids, now),
      this.store.invisibleAmong(ids, now),
    ]);

    return Object.fromEntries(
      userIds.map((id) => [
        id,
        visible.has(id) && connected.has(id) && !invisible.has(id)
          ? 'ONLINE'
          : 'OFFLINE',
      ]),
    );
  }

  async setMine(userId: string, dto: SetPresenceDto): Promise<MyPresence> {
    if (dto.status === 'ONLINE') {
      await this.store.clearInvisible(userId);
    } else {
      if (!dto.duration) {
        throw new BadRequestException('Say how long to stay invisible');
      }
      const length = INVISIBLE_DURATIONS_MS[dto.duration];
      await this.store.setInvisible(
        userId,
        length === null ? null : Date.now() + length,
      );
    }

    await this.refresh(userId);
    return this.getMine(userId);
  }

  /** A socket connected or pinged: the person is here, and others hear about it if they were not before. */
  async socketAlive(userId: string, socketId: string): Promise<void> {
    const { added, count } = await this.store.touchSocket(
      userId,
      socketId,
      Date.now(),
    );
    if (added && count === 1) await this.announce(userId);
  }

  async socketGone(userId: string, socketId: string): Promise<void> {
    const left = await this.store.dropSocket(userId, socketId, Date.now());
    if (left === 0) await this.announce(userId);
  }

  /** Brings back everyone whose invisibility has ended. */
  async expireDue(): Promise<void> {
    for (const userId of await this.store.popExpired(Date.now())) {
      await this.refresh(userId);
    }
  }

  /** Tells the person's own tabs their choice, and everyone who can see them how they now look. */
  private async refresh(userId: string): Promise<void> {
    this.registry.server
      ?.to(userRoom(userId))
      .emit('presence:self', await this.getMine(userId));
    await this.announce(userId);
  }

  private async announce(userId: string): Promise<void> {
    const server = this.registry.server;
    if (!server) return;

    const now = Date.now();
    const [connected, invisible, audience] = await Promise.all([
      this.store.connectedAmong([userId], now),
      this.store.invisibleAmong([userId], now),
      this.repository.findAudienceIds(userId),
    ]);
    if (audience.length === 0) return;

    const status: PublicPresence =
      connected.has(userId) && !invisible.has(userId) ? 'ONLINE' : 'OFFLINE';
    server
      .to(audience.map(userRoom))
      .emit('presence:update', { userId, status });
  }
}
