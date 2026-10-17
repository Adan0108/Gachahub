import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import {
  EXPIRIES_KEY,
  SOCKET_STALE_AFTER_MS,
  preferenceKey,
  socketsKey,
} from './presence.constants';

/** What someone chose: invisible until a time, or with no end. Absent means online. */
export interface InvisiblePreference {
  /** Epoch ms the invisibility ends; null for forever. */
  until: number | null;
}

/** Redis state behind presence: who is connected, and who chose to be invisible. */
@Injectable()
export class PresenceStore {
  constructor(private readonly redis: RedisService) {}

  /** Marks this socket alive now; says whether it just appeared and how many sockets the person has. */
  touchSocket(userId: string, socketId: string, nowMs: number) {
    return this.redis.sortedSetTouch(
      socketsKey(userId),
      socketId,
      nowMs,
      SOCKET_STALE_AFTER_MS,
    );
  }

  /** Forgets a socket; returns how many the person still has. */
  dropSocket(userId: string, socketId: string, nowMs: number) {
    return this.redis.sortedSetRemoveMember(
      socketsKey(userId),
      socketId,
      nowMs,
      SOCKET_STALE_AFTER_MS,
    );
  }

  async connectedAmong(userIds: string[], nowMs: number): Promise<Set<string>> {
    const counts = await Promise.all(
      userIds.map((userId) =>
        this.redis.sortedSetLiveCount(
          socketsKey(userId),
          nowMs,
          SOCKET_STALE_AFTER_MS,
        ),
      ),
    );

    return new Set(userIds.filter((_, index) => counts[index] > 0));
  }

  async getInvisible(userId: string): Promise<InvisiblePreference | null> {
    return this.redis.getJson<InvisiblePreference>(preferenceKey(userId));
  }

  async invisibleAmong(userIds: string[], nowMs: number): Promise<Set<string>> {
    const preferences = await Promise.all(
      userIds.map((userId) => this.getInvisible(userId)),
    );

    return new Set(
      userIds.filter((_, index) => isInvisible(preferences[index], nowMs)),
    );
  }

  async setInvisible(userId: string, until: number | null) {
    await this.redis.setJson<InvisiblePreference>(preferenceKey(userId), {
      until,
    });
    if (until === null) {
      await this.redis.sortedSetRemove(EXPIRIES_KEY, userId);
    } else {
      await this.redis.sortedSetAdd(EXPIRIES_KEY, userId, until);
    }
  }

  async clearInvisible(userId: string) {
    await this.redis.delete(preferenceKey(userId));
    await this.redis.sortedSetRemove(EXPIRIES_KEY, userId);
  }

  /** People whose invisibility has ended; each is cleared here, so each comes back once. */
  async popExpired(nowMs: number): Promise<string[]> {
    const due = await this.redis.sortedSetPopDue(EXPIRIES_KEY, nowMs);
    const expired: string[] = [];

    for (const userId of due) {
      const preference = await this.getInvisible(userId);
      // Someone who chose again after being queued has a newer end time: leave that one alone.
      if (preference?.until != null && preference.until <= nowMs) {
        await this.redis.delete(preferenceKey(userId));
        expired.push(userId);
      }
    }

    return expired;
  }
}

export function isInvisible(
  preference: InvisiblePreference | null | undefined,
  nowMs: number,
): boolean {
  if (!preference) return false;
  return preference.until === null || preference.until > nowMs;
}
