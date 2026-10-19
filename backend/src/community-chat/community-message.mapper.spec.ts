import type { CommunityMessageRow } from './community-chat.repository';
import {
  toCommunityMessage,
  toCommunityReactions,
  type ViewerContext,
} from './community-message.mapper';

const at = new Date('2026-10-16T10:00:00.000Z');

const viewer = (extra: Partial<ViewerContext> = {}): ViewerContext => ({
  moderatorIds: new Set(),
  blockedIds: new Set(),
  ...extra,
});

const row = (
  extra: Partial<CommunityMessageRow> = {},
): CommunityMessageRow => ({
  id: 'm1',
  channelId: 'c1',
  authorId: 'u1',
  content: 'hello',
  replyToId: null,
  clientMessageId: null,
  editedAt: null,
  deletedAt: null,
  deletedById: null,
  deleteReason: null,
  createdAt: at,
  author: { id: 'u1', name: 'Ann', image: null, role: 'USER' },
  replyTo: null,
  reactions: [],
  ...extra,
});

describe('toCommunityMessage', () => {
  it('shows a message with its author and time', () => {
    expect(toCommunityMessage(row(), viewer())).toMatchObject({
      id: 'm1',
      channelId: 'c1',
      content: 'hello',
      deleted: false,
      createdAt: '2026-10-16T10:00:00.000Z',
      editedAt: null,
      author: { id: 'u1', name: 'Ann', image: null, badge: null },
    });
  });

  it('never sends the text of a removed message', () => {
    const message = toCommunityMessage(row({ deletedAt: at }), viewer());

    expect(message.deleted).toBe(true);
    expect(message.content).toBeNull();
    expect(JSON.stringify(message)).not.toContain('hello');
  });

  it('badges an admin, and a moderator of this community', () => {
    const admin = row({
      author: { id: 'u2', name: 'Root', image: null, role: 'ADMIN' },
    });

    expect(toCommunityMessage(admin, viewer()).author?.badge).toBe('ADMIN');
    expect(
      toCommunityMessage(row(), viewer({ moderatorIds: new Set(['u1']) }))
        .author?.badge,
    ).toBe('MODERATOR');
  });

  it('shows a message from an account that is gone without an author', () => {
    const message = toCommunityMessage(
      row({ authorId: null, author: null }),
      viewer(),
    );

    expect(message.author).toBeNull();
    expect(message.content).toBe('hello');
  });

  it('quotes a reply, shortened, with who wrote it', () => {
    const long = 'x'.repeat(300);
    const message = toCommunityMessage(
      row({
        replyToId: 'm0',
        replyTo: {
          id: 'm0',
          content: long,
          deletedAt: null,
          author: { id: 'u3', name: 'Bo' },
        },
      }),
      viewer(),
    );

    expect(message.replyTo?.authorName).toBe('Bo');
    expect(Array.from(message.replyTo!.content!).length).toBe(140);
    expect(message.replyTo!.content!.endsWith('…')).toBe(true);
  });

  it('does not quote the text of a reply target that was removed', () => {
    const message = toCommunityMessage(
      row({
        replyToId: 'm0',
        replyTo: { id: 'm0', content: 'secret', deletedAt: at, author: null },
      }),
      viewer(),
    );

    expect(message.replyTo).toEqual({
      id: 'm0',
      deleted: true,
      blocked: false,
      content: null,
      authorName: null,
    });
  });

  describe('for a viewer who blocked the author', () => {
    const blocked = viewer({ blockedIds: new Set(['u1']) });

    it('keeps the place of the message but nothing in it', () => {
      const message = toCommunityMessage(
        row({
          editedAt: at,
          replyTo: {
            id: 'm0',
            content: 'mine',
            deletedAt: null,
            author: { id: 'me', name: 'Me' },
          },
          reactions: [
            { userId: 'u2', emoji: '👍', emoteId: null, emote: null },
          ],
        }),
        blocked,
      );

      expect(message).toMatchObject({
        id: 'm1',
        channelId: 'c1',
        blocked: true,
        deleted: false,
        content: null,
        author: null,
        replyTo: null,
        editedAt: null,
        reactions: [],
      });
      expect(JSON.stringify(message)).not.toContain('hello');
      expect(JSON.stringify(message)).not.toContain('Ann');
    });

    it('does not touch messages by anyone else', () => {
      const other = row({
        author: { id: 'u9', name: 'Cy', image: null, role: 'USER' },
      });

      expect(toCommunityMessage(other, blocked)).toMatchObject({
        blocked: false,
        content: 'hello',
      });
    });

    it('hides the quote when the blocked person wrote the message being replied to', () => {
      const message = toCommunityMessage(
        row({
          authorId: 'u2',
          author: { id: 'u2', name: 'Bo', image: null, role: 'USER' },
          replyToId: 'm0',
          replyTo: {
            id: 'm0',
            content: 'secret words',
            deletedAt: null,
            author: { id: 'u1', name: 'Ann' },
          },
        }),
        blocked,
      );

      expect(message.replyTo).toEqual({
        id: 'm0',
        deleted: false,
        blocked: true,
        content: null,
        authorName: null,
      });
      expect(JSON.stringify(message)).not.toContain('secret words');
    });
  });

  it('carries reactions with their emote', () => {
    const emote = {
      id: 'e1',
      shortcode: 'pity',
      unicode: null,
      imageUrl: 'https://res.cloudinary.com/x/pity.png',
      animationUrl: null,
      width: 64,
      height: 64,
      mimeType: 'image/png',
      deletedAt: null,
    };
    const message = toCommunityMessage(
      row({
        reactions: [
          { userId: 'u2', emoji: '👍', emoteId: null, emote: null },
          { userId: 'u3', emoji: null, emoteId: 'e1', emote },
        ],
      }),
      viewer(),
    );

    expect(message.reactions).toEqual([
      { userId: 'u2', emoji: '👍', emoteId: null, emote: null },
      { userId: 'u3', emoji: null, emoteId: 'e1', emote },
    ]);
  });
});

describe('toCommunityReactions', () => {
  it('answers with the message id and its reactions alone', () => {
    const result = toCommunityReactions('m1', [
      { userId: 'u1', emoji: '👍', emoteId: null, emote: null },
    ]);

    expect(Object.keys(result).sort()).toEqual(['id', 'reactions']);
    expect(result.id).toBe('m1');
    expect(result.reactions).toHaveLength(1);
  });

  it('is empty when nobody has reacted', () => {
    expect(toCommunityReactions('m1', [])).toEqual({ id: 'm1', reactions: [] });
  });
});
