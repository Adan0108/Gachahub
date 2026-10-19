import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CommunityActionsService } from './community-actions.service';
import { row, scope } from './community-chat.fixtures';

const ZWSP = String.fromCodePoint(0x200b);

describe('CommunityActionsService', () => {
  const repository = {
    updateContent: jest.fn(),
    softDelete: jest.fn(),
    findUsableEmote: jest.fn(),
    upsertReaction: jest.fn(),
    deleteReaction: jest.fn(),
    findReactions: jest.fn(),
  };
  const access = { scope: jest.fn(), messageIn: jest.fn() };
  const presenter = { one: jest.fn() };
  const realtime = { changed: jest.fn() };

  let service: CommunityActionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    access.scope.mockResolvedValue(scope());
    access.messageIn.mockResolvedValue(row());
    repository.findReactions.mockResolvedValue([]);
    // The presenter is covered by its own spec; here it just echoes what it was given.
    presenter.one.mockImplementation((_scope: unknown, message: unknown) =>
      Promise.resolve(message),
    );
    service = new CommunityActionsService(
      repository as never,
      access as never,
      presenter as never,
      realtime as never,
    );
  });

  describe('edit', () => {
    const edit = (content = 'fixed') =>
      service.edit('wuwa', 'm1', { content }, 'me');

    it('changes your own message', async () => {
      repository.updateContent.mockResolvedValue(
        row({ content: 'fixed', editedAt: new Date() }),
      );

      const message = await edit();

      expect(repository.updateContent).toHaveBeenCalledWith('m1', 'fixed');
      expect(message).toMatchObject({ content: 'fixed' });
      expect(message?.editedAt).not.toBeNull();
    });

    it('tells the room when the text changed, not when it did not', async () => {
      repository.updateContent.mockResolvedValue(row({ content: 'fixed' }));
      await edit();
      expect(realtime.changed).toHaveBeenCalledWith('c1', 'm1');

      realtime.changed.mockClear();
      access.messageIn.mockResolvedValue(row({ content: 'same' }));
      await edit('same');
      expect(realtime.changed).not.toHaveBeenCalled();
    });

    it('does nothing when the text is the same', async () => {
      access.messageIn.mockResolvedValue(row({ content: 'same' }));

      await edit('same');

      expect(repository.updateContent).not.toHaveBeenCalled();
    });

    it("refuses to change someone else's message, even for a moderator", async () => {
      access.scope.mockResolvedValue(scope({ canModerate: true }));
      access.messageIn.mockResolvedValue(row({ authorId: 'someone' }));

      await expect(edit()).rejects.toThrow(ForbiddenException);
    });

    it('refuses a removed message', async () => {
      access.messageIn.mockResolvedValue(row({ deletedAt: new Date() }));

      await expect(edit()).rejects.toThrow(/removed/);
    });

    it('refuses once the shared edit window has closed', async () => {
      access.messageIn.mockResolvedValue(
        row({ createdAt: new Date(Date.now() - 16 * 60 * 1000) }),
      );

      await expect(edit()).rejects.toThrow(/15 minutes/);
    });

    it('checks the new text like a new message', async () => {
      await expect(edit(` ${ZWSP} `)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    const remove = (reason?: string) =>
      service.remove('wuwa', 'm1', { reason }, 'me');

    it('removes your own message and ignores a reason', async () => {
      repository.softDelete.mockResolvedValue(row({ deletedAt: new Date() }));

      await remove('because');

      expect(repository.softDelete).toHaveBeenCalledWith('m1', 'me', undefined);
    });

    it('tells the room a message went, and not again the second time', async () => {
      repository.softDelete.mockResolvedValue(row({ deletedAt: new Date() }));
      await remove();
      expect(realtime.changed).toHaveBeenCalledWith('c1', 'm1');

      realtime.changed.mockClear();
      access.messageIn.mockResolvedValue(row({ deletedAt: new Date() }));
      await remove();
      expect(realtime.changed).not.toHaveBeenCalled();
    });

    it("refuses to remove someone else's message", async () => {
      access.messageIn.mockResolvedValue(row({ authorId: 'someone' }));

      await expect(remove()).rejects.toThrow(ForbiddenException);
      expect(repository.softDelete).not.toHaveBeenCalled();
    });

    it('lets a moderator or admin remove anyone, keeping a trimmed reason', async () => {
      access.scope.mockResolvedValue(scope({ canModerate: true }));
      access.messageIn.mockResolvedValue(row({ authorId: 'someone' }));
      repository.softDelete.mockResolvedValue(
        row({ authorId: 'someone', deletedAt: new Date() }),
      );

      await remove('  spam  ');

      expect(repository.softDelete).toHaveBeenCalledWith('m1', 'me', 'spam');
    });

    it('does nothing the second time', async () => {
      const gone = row({ deletedAt: new Date() });
      access.messageIn.mockResolvedValue(gone);

      expect(await remove()).toBe(gone);
      expect(repository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('reactions', () => {
    it('reacts with an emoji and returns the message reactions alone', async () => {
      repository.findReactions.mockResolvedValue([
        { userId: 'me', emoji: '👍', emoteId: null, emote: null },
      ]);

      const result = await service.react('wuwa', 'm1', { emoji: '👍' }, 'me');

      expect(repository.upsertReaction).toHaveBeenCalledWith({
        messageId: 'm1',
        userId: 'me',
        emoji: '👍',
        emoteId: undefined,
      });
      expect(result.id).toBe('m1');
      expect(result.reactions).toHaveLength(1);
      expect(presenter.one).not.toHaveBeenCalled();
    });

    it('reacts with an emote this community can use', async () => {
      repository.findUsableEmote.mockResolvedValue({ id: 'e1' });

      await service.react('wuwa', 'm1', { emoteId: 'e1' }, 'me');

      expect(repository.findUsableEmote).toHaveBeenCalledWith('e1', 'g1');
      expect(repository.upsertReaction).toHaveBeenCalledWith(
        expect.objectContaining({ emoteId: 'e1' }),
      );
    });

    it('refuses an emote from somewhere else', async () => {
      repository.findUsableEmote.mockResolvedValue(null);

      await expect(
        service.react('wuwa', 'm1', { emoteId: 'foreign' }, 'me'),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.upsertReaction).not.toHaveBeenCalled();
    });

    it('tells the room about a reaction given or taken back', async () => {
      await service.react('wuwa', 'm1', { emoji: '👍' }, 'me');
      await service.unreact('wuwa', 'm1', 'me');

      expect(realtime.changed).toHaveBeenCalledTimes(2);
      expect(realtime.changed).toHaveBeenCalledWith('c1', 'm1');
    });

    it('refuses to react to a removed message', async () => {
      access.messageIn.mockResolvedValue(row({ deletedAt: new Date() }));

      await expect(
        service.react('wuwa', 'm1', { emoji: '👍' }, 'me'),
      ).rejects.toThrow(/removed/);
    });

    it('takes a reaction back and returns what is left', async () => {
      const result = await service.unreact('wuwa', 'm1', 'me');

      expect(repository.deleteReaction).toHaveBeenCalledWith('m1', 'me');
      expect(result).toEqual({ id: 'm1', reactions: [] });
    });
  });
});
