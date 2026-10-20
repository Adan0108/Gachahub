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
    /** The quoted message has pictures, so the client can say Photo when there is no text. */
    hasMedia: boolean;
    authorName: string | null;
  } | null;
  /** Images shown with the message; none once it is removed or its author is blocked. */
  media: CommunityMedia[];
  /** Handles in the text that name real members, so they can be shown as mentions. */
  mentions: string[];
  reactions: CommunityReaction[];
}

export interface CommunityMedia {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export type CommunityReaction = CommunityReactionRow;

/** What a reaction request answers with: just the reactions, since nothing else about the message changed. */
export interface CommunityReactions {
  id: string;
  reactions: CommunityReaction[];
}

function toMedia(media: CommunityMessageRow['media'][number]): CommunityMedia {
  return {
    id: media.id,
    url: media.url,
    width: media.width,
    height: media.height,
  };
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
    hasMedia: !deleted && !blocked && reply.media.length > 0,
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
  /** Handles each message pinged, by message id. */
  mentionsById?: ReadonlyMap<string, string[]>;
}

/** What one viewer sees of a message; a removed or blocked one keeps its place but loses its text. */
export function toCommunityMessage(
  row: CommunityMessageRow,
  { moderatorIds, blockedIds, mentionsById }: ViewerContext,
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
      media: [],
      mentions: [],
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
    media: deleted ? [] : row.media.map(toMedia),
    mentions: deleted ? [] : (mentionsById?.get(row.id) ?? []),
    reactions: row.reactions.map(toReaction),
  };
}
