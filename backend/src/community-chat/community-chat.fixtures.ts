// Shared test data for the community chat specs; not a spec itself, so Jest does not run it.
import type { CommunityMessageRow } from './community-chat.repository';

export const game = {
  id: 'g1',
  slug: 'wuwa',
  name: 'Wuthering Waves',
  status: 'ACTIVE',
};

export const channel = {
  id: 'c1',
  gameId: 'g1',
  slug: 'general',
  name: 'general',
  topic: null,
  kind: 'TEXT',
  sortOrder: 0,
  slowmodeSeconds: 0,
  isLocked: false,
  archivedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

/** A stored message by `me`, as the repository returns it. */
export const row = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'm1',
    channelId: 'c1',
    authorId: 'me',
    content: 'hello',
    replyToId: null,
    clientMessageId: null,
    editedAt: null,
    deletedAt: null,
    deletedById: null,
    deleteReason: null,
    createdAt: new Date(),
    author: { id: 'me', name: 'Me', image: null, role: 'USER' },
    replyTo: null,
    reactions: [],
    channel: { id: 'c1', gameId: 'g1', isLocked: false },
    ...extra,
  }) as unknown as CommunityMessageRow & { channel: object };

/** What CommunityAccessService.scope returns for a plain member. */
export const scope = (extra: Record<string, unknown> = {}) => ({
  user: { id: 'me', role: 'USER', status: 'ACTIVE' },
  game,
  membership: { createdAt: new Date('2026-10-02T00:00:00Z') },
  canModerate: false,
  ...extra,
});
