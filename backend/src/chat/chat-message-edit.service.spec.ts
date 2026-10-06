import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
jest.mock('./chat.repository', () => ({ ChatRepository: class {} }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
}));
jest.mock('./chat-message-rate-limiter.service', () => ({
  ChatMessageRateLimiterService: class {},
}));
jest.mock('../follows/follows.service', () => ({ FollowsService: class {} }));
jest.mock('../blocks/blocks.service', () => ({ BlocksService: class {} }));
jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));
// real Prisma namespace: the unique-violation check uses `instanceof` against it
function loadActualPrisma() {
  const actual: { Prisma: typeof import('../generated/prisma/client').Prisma } =
    jest.requireActual('../generated/prisma/client');
  return actual.Prisma;
}
jest.mock('../generated/prisma/client', () => ({
  Prisma: loadActualPrisma(),
}));

import { Prisma } from '../generated/prisma/client';
import { MembershipChangePendingException } from '../common/exceptions/membership-change-pending.exception';
import { ChatAccessService } from './chat-access.service';
import { ChatMessageEditService } from './chat-message-edit.service';
import { MESSAGE_EDIT_WINDOW_MS } from './message-edit-policy';

describe('ChatMessageEditService', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');

  const repository = {
    findMessageBySenderClientMessageId: jest.fn(),
    findMessageWithParticipants: jest.fn(),
    lockAndFindParticipants: jest.fn(),
    markMessageEdited: jest.fn(),
    countEditsOfMessage: jest.fn(),
    createEditMessage: jest.fn(),
  };
  const blocksService = { isBlocked: jest.fn() };
  const chatDevicesService = { assertSessionLinkedToActiveDevice: jest.fn() };
  const rateLimiter = { assertNotRateLimited: jest.fn() };
  const messageEncryption = { preparePayload: jest.fn() };
  const chatDelivery = { publishMessageEdited: jest.fn() };
  const tx = {};
  const prisma = {
    $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
  };

  const participants = (overrides: Record<string, string> = {}) => [
    {
      userId: 'user-1',
      state: overrides['user-1'] ?? 'ACTIVE',
      deletedAt: null,
    },
    {
      userId: 'user-2',
      state: overrides['user-2'] ?? 'ACTIVE',
      deletedAt: null,
    },
  ];

  const target = (overrides: Record<string, unknown> = {}) => ({
    id: 'message-1',
    conversationId: 'conversation-1',
    senderId: 'user-1',
    status: 'SENT',
    contentType: 'TEXT',
    createdAt: new Date(NOW.getTime() - 60_000),
    conversation: { type: 'DIRECT', participants: participants() },
    ...overrides,
  });

  const dto = { ciphertext: 'new-cipher', clientMessageId: 'client-1' };
  const created = {
    id: 'edit-1',
    contentType: 'EDIT',
    editsMessageId: 'message-1',
  };

  let service: ChatMessageEditService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    const access = new ChatAccessService(
      repository as never,
      {} as never,
      blocksService as never,
      {} as never,
    );
    service = new ChatMessageEditService(
      repository as never,
      access,
      chatDevicesService as never,
      rateLimiter as never,
      messageEncryption,
      chatDelivery as never,
      prisma as never,
    );
    blocksService.isBlocked.mockResolvedValue(false);
    repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
    repository.findMessageWithParticipants.mockResolvedValue(target());
    repository.lockAndFindParticipants.mockResolvedValue(participants());
    repository.markMessageEdited.mockResolvedValue(true);
    repository.countEditsOfMessage.mockResolvedValue(0);
    repository.createEditMessage.mockResolvedValue(created);
    messageEncryption.preparePayload.mockResolvedValue({
      ciphertext: 'new-cipher',
      encryptionMeta: { v: 1 },
    });
  });
  afterEach(() => jest.useRealTimers());

  const edit = (messageId = 'message-1') =>
    service.editMessage('user-1', 'session-1', messageId, dto);

  describe('a valid edit', () => {
    it('stores a hidden edit of the message, stamps it edited, and tells the others', async () => {
      const result = await edit();

      expect(repository.markMessageEdited).toHaveBeenCalledWith(
        tx,
        'message-1',
        NOW,
      );
      expect(repository.createEditMessage).toHaveBeenCalledWith(tx, {
        conversationId: 'conversation-1',
        senderId: 'user-1',
        participantUserIds: ['user-1', 'user-2'],
        editsMessageId: 'message-1',
        ciphertext: 'new-cipher',
        encryptionMeta: { v: 1 },
        clientMessageId: 'client-1',
      });
      expect(chatDelivery.publishMessageEdited).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actorId: 'user-1',
        recipientUserIds: ['user-2'],
      });
      expect(result).toEqual({
        conversationId: 'conversation-1',
        message: created,
        duplicate: false,
      });
    });

    it('checks the linked device and the send rate limit first', async () => {
      chatDevicesService.assertSessionLinkedToActiveDevice.mockRejectedValue(
        new ForbiddenException('no device'),
      );

      await expect(edit()).rejects.toThrow(ForbiddenException);
      expect(repository.findMessageWithParticipants).not.toHaveBeenCalled();

      chatDevicesService.assertSessionLinkedToActiveDevice.mockResolvedValue(
        undefined,
      );
      await edit();
      expect(rateLimiter.assertNotRateLimited).toHaveBeenCalledWith('user-1');
    });

    it('allows an edit at the very end of the 15 minute window', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({ createdAt: new Date(NOW.getTime() - MESSAGE_EDIT_WINDOW_MS) }),
      );

      await expect(edit()).resolves.toMatchObject({ duplicate: false });
    });
  });

  describe('retries', () => {
    it('returns the edit already stored for the same clientMessageId without editing again', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'edit-1',
        conversationId: 'conversation-1',
        editsMessageId: 'message-1',
      });

      const result = await edit();

      expect(result).toMatchObject({ duplicate: true });
      expect(repository.createEditMessage).not.toHaveBeenCalled();
      expect(chatDelivery.publishMessageEdited).not.toHaveBeenCalled();
    });

    it('refuses a clientMessageId already used for something else', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'other',
        conversationId: 'conversation-1',
        editsMessageId: null,
      });

      await expect(edit()).rejects.toThrow(ConflictException);
    });

    it('returns the winner when two retries race on the unique clientMessageId', async () => {
      const race = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['senderId', 'clientMessageId'] },
      });
      repository.createEditMessage.mockRejectedValue(race);
      repository.findMessageBySenderClientMessageId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'edit-1',
          conversationId: 'conversation-1',
          editsMessageId: 'message-1',
        });

      await expect(edit()).resolves.toMatchObject({ duplicate: true });
      expect(chatDelivery.publishMessageEdited).not.toHaveBeenCalled();
    });
  });

  describe('who and what can be edited', () => {
    it.each([
      ['does not exist', null],
      ['was unsent', target({ status: 'DELETED' })],
      ['is itself a hidden edit', target({ contentType: 'EDIT' })],
    ])('treats a message that %s as not found', async (_name, found) => {
      repository.findMessageWithParticipants.mockResolvedValue(found);

      await expect(edit()).rejects.toThrow(NotFoundException);
      expect(repository.createEditMessage).not.toHaveBeenCalled();
    });

    it('tells someone outside the conversation nothing about the message', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          conversation: {
            type: 'DIRECT',
            participants: [
              { userId: 'user-9', state: 'ACTIVE', deletedAt: null },
            ],
          },
        }),
      );

      await expect(edit()).rejects.toThrow(NotFoundException);
    });

    it("refuses to edit someone else's message", async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({ senderId: 'user-2' }),
      );

      await expect(edit()).rejects.toThrow(ForbiddenException);
    });

    it.each(['IMAGE', 'FILE', 'VIDEO', 'AUDIO', 'EMOTE', 'SYSTEM'])(
      'refuses to edit a %s message (text only for now)',
      async (contentType) => {
        repository.findMessageWithParticipants.mockResolvedValue(
          target({ contentType }),
        );

        await expect(edit()).rejects.toMatchObject({
          response: expect.objectContaining({
            code: 'EDIT_NOT_SUPPORTED',
          }) as unknown,
        });
      },
    );

    it('refuses once the 15 minute window has closed', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          createdAt: new Date(NOW.getTime() - MESSAGE_EDIT_WINDOW_MS - 1),
        }),
      );

      await expect(edit()).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'EDIT_WINDOW_CLOSED',
        }) as unknown,
      });
      expect(repository.createEditMessage).not.toHaveBeenCalled();
    });

    it('refuses an 11th edit and stores nothing', async () => {
      repository.countEditsOfMessage.mockResolvedValue(10);

      await expect(edit()).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'EDIT_LIMIT_REACHED',
        }) as unknown,
      });
      expect(repository.createEditMessage).not.toHaveBeenCalled();
      expect(chatDelivery.publishMessageEdited).not.toHaveBeenCalled();
    });

    it('allows the 10th edit', async () => {
      repository.countEditsOfMessage.mockResolvedValue(9);

      await expect(edit()).resolves.toMatchObject({ duplicate: false });
    });

    it('treats a message unsent while the edit was being saved as not found', async () => {
      repository.markMessageEdited.mockResolvedValue(false);

      await expect(edit()).rejects.toThrow(NotFoundException);
      expect(repository.createEditMessage).not.toHaveBeenCalled();
    });

    it('rejects an edit whose ciphertext is not an MLS message', async () => {
      messageEncryption.preparePayload.mockRejectedValue(
        new BadRequestException('bad'),
      );

      await expect(edit()).rejects.toThrow(BadRequestException);
      expect(repository.createEditMessage).not.toHaveBeenCalled();
    });
  });

  describe('the same conditions as sending', () => {
    it('makes the editor wait while a group member is being removed', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          conversation: {
            type: 'GROUP',
            participants: participants({ 'user-2': 'LEAVING' }),
          },
        }),
      );

      await expect(edit()).rejects.toThrow(MembershipChangePendingException);
    });

    it('also catches a removal that started after the first read, under the lock', async () => {
      repository.lockAndFindParticipants.mockResolvedValue(
        participants({ 'user-2': 'LEAVING' }),
      );

      await expect(edit()).rejects.toThrow(MembershipChangePendingException);
      expect(repository.createEditMessage).not.toHaveBeenCalled();
    });

    it('refuses an editor who is not active in the conversation', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          conversation: {
            type: 'DIRECT',
            participants: participants({ 'user-1': 'ARCHIVED' }),
          },
        }),
      );

      await expect(edit()).rejects.toThrow(ForbiddenException);
    });

    it('refuses an editor who has blocked the other person in a direct chat', async () => {
      blocksService.isBlocked.mockResolvedValue(true);

      await expect(edit()).rejects.toThrow(ForbiddenException);
    });

    it('refuses when the other person declined the conversation', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          conversation: {
            type: 'DIRECT',
            participants: participants({ 'user-2': 'DECLINED' }),
          },
        }),
      );

      await expect(edit()).rejects.toThrow(ForbiddenException);
    });

    it('only tells members who are still in a group', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        target({
          conversation: {
            type: 'GROUP',
            participants: [
              ...participants(),
              { userId: 'user-3', state: 'DECLINED', deletedAt: null },
            ],
          },
        }),
      );

      await edit();

      expect(chatDelivery.publishMessageEdited).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserIds: ['user-2'] }),
      );
    });
  });
});
