import { scope, row } from './community-chat.fixtures';
import { CommunityMessagePresenter } from './community-message.presenter';

const bo = { id: 'bo', name: 'Bo', image: null, role: 'USER' };

describe('CommunityMessagePresenter', () => {
  const repository = {
    findModeratorIds: jest.fn(),
    findMentionUsernames: jest.fn(),
  };
  const blocks = { getBlockedIdsAmong: jest.fn() };
  let presenter: CommunityMessagePresenter;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findModeratorIds.mockResolvedValue(new Set());
    repository.findMentionUsernames.mockResolvedValue(new Map());
    blocks.getBlockedIdsAmong.mockResolvedValue(new Set());
    presenter = new CommunityMessagePresenter(
      repository as never,
      blocks as never,
    );
  });

  describe('page', () => {
    it('badges moderators and hides blocked people, with two queries for the whole page', async () => {
      repository.findModeratorIds.mockResolvedValue(new Set(['bo']));
      blocks.getBlockedIdsAmong.mockResolvedValue(new Set(['cy']));
      const cy = { id: 'cy', name: 'Cy', image: null, role: 'USER' };

      const items = await presenter.page('g1', 'me', [
        row({ id: 'm1', authorId: 'bo', author: bo }),
        row({ id: 'm2', authorId: 'cy', author: cy, content: 'hidden words' }),
        row({ id: 'm3' }),
      ]);

      expect(
        items.map((item) => [
          item?.id,
          item?.author?.badge ?? null,
          item?.blocked,
        ]),
      ).toEqual([
        ['m1', 'MODERATOR', false],
        ['m2', null, true],
        ['m3', null, false],
      ]);
      expect(JSON.stringify(items)).not.toContain('hidden words');
      expect(repository.findModeratorIds).toHaveBeenCalledTimes(1);
      expect(blocks.getBlockedIdsAmong).toHaveBeenCalledTimes(1);
    });

    it('asks about each person once, including the authors of quoted messages, for the viewer', async () => {
      await presenter.page('g1', 'me', [
        row({ id: 'm3', authorId: 'bo', author: bo }),
        row({
          id: 'm2',
          authorId: 'bo',
          author: bo,
          replyTo: {
            id: 'm0',
            content: 'hi',
            deletedAt: null,
            author: { id: 'cy', name: 'Cy' },
            media: [],
          },
        }),
      ]);

      const [gameId, ids] = repository.findModeratorIds.mock.calls[0] as [
        string,
        string[],
      ];
      expect(gameId).toBe('g1');
      expect([...ids].sort()).toEqual(['bo', 'cy']);
      expect(blocks.getBlockedIdsAmong).toHaveBeenCalledWith(
        'me',
        expect.any(Array),
      );
    });

    it('copes with no messages', async () => {
      expect(await presenter.page('g1', 'me', [])).toEqual([]);
    });
  });

  describe('one: a message the viewer has just written or changed', () => {
    it('asks nothing for their own plain message', async () => {
      const message = await presenter.one(scope() as never, row());

      expect(message).toMatchObject({
        id: 'm1',
        blocked: false,
        content: 'hello',
      });
      expect(repository.findModeratorIds).not.toHaveBeenCalled();
      expect(blocks.getBlockedIdsAmong).not.toHaveBeenCalled();
    });

    it('badges a moderator from what their scope already says', async () => {
      const message = await presenter.one(
        scope({ canModerate: true }) as never,
        row(),
      );

      expect(message?.author?.badge).toBe('MODERATOR');
      expect(repository.findModeratorIds).not.toHaveBeenCalled();
    });

    it('badges an admin as an admin', async () => {
      const admin = row({
        author: { id: 'me', name: 'Me', image: null, role: 'ADMIN' },
      });

      const message = await presenter.one(
        scope({ canModerate: true }) as never,
        admin,
      );

      expect(message?.author?.badge).toBe('ADMIN');
    });

    it('does not badge a member', async () => {
      expect(
        (await presenter.one(scope() as never, row()))?.author?.badge,
      ).toBeNull();
    });

    it('asks once, about the quoted person only, when replying to someone else', async () => {
      blocks.getBlockedIdsAmong.mockResolvedValue(new Set(['bo']));
      const reply = row({
        replyToId: 'm0',
        replyTo: {
          id: 'm0',
          content: 'hi',
          deletedAt: null,
          author: { id: 'bo', name: 'Bo' },
          media: [],
        },
      });

      const message = await presenter.one(scope() as never, reply);

      expect(blocks.getBlockedIdsAmong).toHaveBeenCalledTimes(1);
      expect(blocks.getBlockedIdsAmong).toHaveBeenCalledWith('me', ['bo']);
      expect(message?.replyTo).toMatchObject({ blocked: true, content: null });
      expect(repository.findModeratorIds).not.toHaveBeenCalled();
    });

    it('asks nothing when replying to themselves', async () => {
      const reply = row({
        replyToId: 'm0',
        replyTo: {
          id: 'm0',
          content: 'mine',
          deletedAt: null,
          author: { id: 'me', name: 'Me' },
          media: [],
        },
      });

      const message = await presenter.one(scope() as never, reply);

      expect(blocks.getBlockedIdsAmong).not.toHaveBeenCalled();
      expect(message?.replyTo).toMatchObject({
        blocked: false,
        content: 'mine',
      });
    });

    it('does the full lookup for a message by someone else, such as one a moderator removed', async () => {
      repository.findModeratorIds.mockResolvedValue(new Set(['bo']));
      const removed = row({
        authorId: 'bo',
        author: bo,
        deletedAt: new Date(),
      });

      const message = await presenter.one(
        scope({ canModerate: true }) as never,
        removed,
      );

      expect(repository.findModeratorIds).toHaveBeenCalledTimes(1);
      expect(blocks.getBlockedIdsAmong).toHaveBeenCalledTimes(1);
      expect(message).toMatchObject({
        deleted: true,
        content: null,
        author: { badge: 'MODERATOR' },
      });
    });

    it('shows a message from an account that is gone', async () => {
      const message = await presenter.one(
        scope() as never,
        row({ authorId: null, author: null }),
      );

      expect(message).toMatchObject({ author: null, content: 'hello' });
    });
  });
});
