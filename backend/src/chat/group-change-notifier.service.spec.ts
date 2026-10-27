import { GroupChangeNotifier } from './group-change-notifier.service';

describe('GroupChangeNotifier', () => {
  const chatRepository = { findConversationWithParticipants: jest.fn() };
  const chatDelivery = { publishConversationUpdated: jest.fn() };
  const notifier = new GroupChangeNotifier(
    chatRepository as never,
    chatDelivery as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    chatRepository.findConversationWithParticipants.mockResolvedValue({
      participants: [
        { userId: 'alice' },
        { userId: 'bob' },
        { userId: 'left' },
      ],
    });
  });

  // CFI-002: a role change reached the database but Bob's open panel still showed Member
  it('tells everyone in the group, removed people included, once the change is saved', async () => {
    await expect(
      notifier.after('c1', () => Promise.resolve('saved')),
    ).resolves.toBe('saved');

    expect(chatDelivery.publishConversationUpdated).toHaveBeenCalledWith({
      conversationId: 'c1',
      recipientUserIds: ['alice', 'bob', 'left'],
    });
  });

  it('announces nothing when the change fails', async () => {
    await expect(
      notifier.after('c1', () => Promise.reject(new Error('forbidden'))),
    ).rejects.toThrow('forbidden');

    expect(chatDelivery.publishConversationUpdated).not.toHaveBeenCalled();
  });

  it('still returns the saved change when announcing it fails', async () => {
    chatDelivery.publishConversationUpdated.mockRejectedValue(
      new Error('socket down'),
    );
    jest.spyOn(notifier['logger'], 'warn').mockImplementation(() => undefined);

    await expect(
      notifier.after('c1', () => Promise.resolve('saved')),
    ).resolves.toBe('saved');
  });
});
