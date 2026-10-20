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
  media: [],
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
          media: [],
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
        replyTo: {
          id: 'm0',
          content: 'secret',
          deletedAt: at,
          author: null,
          media: [],
        },
      }),
      viewer(),
    );

    expect(message.replyTo).toEqual({
      id: 'm0',
      deleted: true,
      blocked: false,
      hasMedia: false,
      content: null,
      authorName: null,
    });
  });

  describe('mentions', () => {
    const named = new Map([['m1', ['bo', 'cara']]]);

    it('lists the handles a message pinged', () => {
      const message = toCommunityMessage(row(), {
        ...viewer(),
        mentionsById: named,
      });

      expect(message.mentions).toEqual(['bo', 'cara']);
    });

    it('lists none when nobody was pinged, or the caller did not ask', () => {
      expect(toCommunityMessage(row(), viewer()).mentions).toEqual([]);
      expect(
        toCommunityMessage(row({ id: 'm2' }), {
          ...viewer(),
          mentionsById: named,
        }).mentions,
      ).toEqual([]);
    });

    it('lists none once the message was removed or its author is blocked', () => {
      expect(
        toCommunityMessage(row({ deletedAt: at }), {
          ...viewer(),
          mentionsById: named,
        }).mentions,
      ).toEqual([]);
      expect(
        toCommunityMessage(row(), {
          ...viewer({ blockedIds: new Set(['u1']) }),
          mentionsById: named,
        }).mentions,
      ).toEqual([]);
    });
  });

  describe('images', () => {
    const image = {
      id: 'i1',
      mediaUploadId: 'up1',
      url: 'https://cdn.example.com/a.png',
      width: 640,
      height: 480,
    };

    it('shows the images of a message without the upload behind them', () => {
      const message = toCommunityMessage(row({ media: [image] }), viewer());

      expect(message.media).toEqual([
        {
          id: 'i1',
          url: 'https://cdn.example.com/a.png',
          width: 640,
          height: 480,
        },
      ]);
    });

    it('shows none once the message was removed', () => {
      const message = toCommunityMessage(
        row({ media: [image], deletedAt: at }),
        viewer(),
      );

      expect(message.media).toEqual([]);
    });

    it('shows none for a viewer who blocked the author', () => {
      const message = toCommunityMessage(
        row({ media: [image] }),
        viewer({ blockedIds: new Set(['u1']) }),
      );

      expect(message.media).toEqual([]);
    });

    it('says a quoted message has pictures, so a picture-only one can still be quoted', () => {
      const message = toCommunityMessage(
        row({
          replyToId: 'm0',
          replyTo: {
            id: 'm0',
            content: '',
            deletedAt: null,
            author: { id: 'u3', name: 'Bo' },
            media: [{ id: 'i1' }],
          },
        }),
        viewer(),
      );

      expect(message.replyTo).toMatchObject({ content: '', hasMedia: true });
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
            media: [],
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
            media: [],
          },
        }),
        blocked,
      );

      expect(message.replyTo).toEqual({
        id: 'm0',
        deleted: false,
        blocked: true,
        hasMedia: false,
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
