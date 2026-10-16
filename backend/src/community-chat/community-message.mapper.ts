import { COMMUNITY_REPLY_SNIPPET_CHARS } from './community-chat.constants';
import type {
  CommunityMessageRow,
  CommunityReactionRow,
} from './community-chat.repository';

export type CommunityBadge = 'ADMIN' | 'MODERATOR';

export interface CommunityMessage {
  id: string;
  channelId: string;
  /** Null once removed or when the viewer has blocked the author; the text stays stored for review but is never sent out. */
  content: string | null;
  deleted: boolean;
  /** The viewer blocked this author: the place is kept, nothing else is shown. */
  blocked: boolean;
  createdAt: string;
  editedAt: string | null;
  author: {
    id: string;
    name: string;
    image: string | null;
    badge: CommunityBadge | null;
  } | null;
  replyTo: {
    id: string;
    content: string | null;
    deleted: boolean;
    blocked: boolean;
    authorName: string | null;
  } | null;
  reactions: CommunityReaction[];
}

export type CommunityReaction = CommunityReactionRow;

/** What a reaction request answers with: just the reactions, since nothing else about the message changed. */
export interface CommunityReactions {
  id: string;
  reactions: CommunityReaction[];
}

function toReaction(reaction: CommunityReactionRow): CommunityReaction {
  return {
    userId: reaction.userId,
    emoji: reaction.emoji,
    emoteId: reaction.emoteId,
    emote: reaction.emote,
  };
}

export function toCommunityReactions(
  messageId: string,
  rows: CommunityReactionRow[],
): CommunityReactions {
  return { id: messageId, reactions: rows.map(toReaction) };
}

function snippet(content: string): string {
  const chars = Array.from(content);
  return chars.length <= COMMUNITY_REPLY_SNIPPET_CHARS
    ? content
    : `${chars.slice(0, COMMUNITY_REPLY_SNIPPET_CHARS - 1).join('')}…`;
}

function presentReply(
  reply: NonNullable<CommunityMessageRow['replyTo']>,
  blockedIds: ReadonlySet<string>,
): NonNullable<CommunityMessage['replyTo']> {
  const blocked = reply.author !== null && blockedIds.has(reply.author.id);
  const deleted = reply.deletedAt !== null;
  return {
    id: reply.id,
    deleted,
    blocked,
    content: deleted || blocked ? null : snippet(reply.content),
    authorName: blocked ? null : (reply.author?.name ?? null),
  };
}

function badgeOf(
  author: CommunityMessageRow['author'],
  moderatorIds: ReadonlySet<string>,
): CommunityBadge | null {
  if (!author) return null;
  if (author.role === 'ADMIN') return 'ADMIN';
  return moderatorIds.has(author.id) ? 'MODERATOR' : null;
}

export interface ViewerContext {
  /** Authors who moderate this community, to badge them. */
  moderatorIds: ReadonlySet<string>;
  /** Authors the viewer has blocked. */
  blockedIds: ReadonlySet<string>;
}

/** What one viewer sees of a message; a removed or blocked one keeps its place but loses its text. */
export function toCommunityMessage(
  row: CommunityMessageRow,
  { moderatorIds, blockedIds }: ViewerContext,
): CommunityMessage {
  const deleted = row.deletedAt !== null;

  if (row.author && blockedIds.has(row.author.id)) {
    return {
      id: row.id,
      channelId: row.channelId,
      content: null,
      deleted: false,
      blocked: true,
      createdAt: row.createdAt.toISOString(),
      editedAt: null,
      author: null,
      replyTo: null,
      reactions: [],
    };
  }

  return {
    id: row.id,
    channelId: row.channelId,
    content: deleted ? null : row.content,
    deleted,
    blocked: false,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    author: row.author
      ? {
          id: row.author.id,
          name: row.author.name,
          image: row.author.image,
          badge: badgeOf(row.author, moderatorIds),
        }
      : null,
    replyTo: row.replyTo ? presentReply(row.replyTo, blockedIds) : null,
    reactions: row.reactions.map(toReaction),
  };
}
