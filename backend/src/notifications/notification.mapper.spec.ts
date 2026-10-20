import { NotificationEntityType } from '../generated/prisma/client';
import {
  commentEntityIds,
  messageEntityIds,
  withConversationIds,
  withConversations,
  withPostIds,
} from './notification.mapper';

const comment = (id: string, entityId: string) => ({
  id,
  entityType: NotificationEntityType.COMMENT,
  entityId,
});
const post = (id: string) => ({
  id,
  entityType: NotificationEntityType.POST,
  entityId: 'post-1',
});

describe('notification mapper', () => {
  it('picks out only the comment entity ids', () => {
    expect(
      commentEntityIds([comment('n1', 'c1'), post('n2'), comment('n3', 'c3')]),
    ).toEqual(['c1', 'c3']);
  });

  it('gives comment notifications the post they sit on and everything else null', () => {
    const result = withPostIds(
      [comment('n1', 'c1'), post('n2')],
      new Map([['c1', 'post-9']]),
    );

    expect(result.map((item) => item.postId)).toEqual(['post-9', null]);
  });

  it('gives a comment with no resolvable post a null post id', () => {
    expect(
      withPostIds([comment('n1', 'gone')], new Map())[0].postId,
    ).toBeNull();
  });

  describe('conversations', () => {
    const message = (id: string, entityId: string) => ({
      id,
      entityType: NotificationEntityType.MESSAGE,
      entityId,
    });
    const conversation = (id: string, entityId: string) => ({
      id,
      entityType: NotificationEntityType.CONVERSATION,
      entityId,
    });

    it('picks out only the message entity ids', () => {
      expect(
        messageEntityIds([
          message('n1', 'm1'),
          post('n2'),
          message('n3', 'm3'),
        ]),
      ).toEqual(['m1', 'm3']);
    });

    it('gives a message notification its conversation, a group one its own id, and the rest null', () => {
      const result = withConversationIds(
        [message('n1', 'm1'), conversation('n2', 'c-group'), post('n3')],
        new Map([['m1', 'c-dm']]),
      );

      expect(result.map((item) => item.conversationId)).toEqual([
        'c-dm',
        'c-group',
        null,
      ]);
    });

    it('gives a message that cannot be found a null conversation', () => {
      expect(
        withConversationIds([message('n1', 'gone')], new Map())[0]
          .conversationId,
      ).toBeNull();
    });
  });

  describe('stacked chat notifications', () => {
    it('trusts the conversation a row carries over looking it up through the message', () => {
      const result = withConversationIds(
        [
          {
            id: 'n1',
            entityType: NotificationEntityType.MESSAGE,
            entityId: 'm1',
            conversationId: 'c-own',
          },
        ],
        new Map([['m1', 'c-lookup']]),
      );

      expect(result[0].conversationId).toBe('c-own');
    });

    it('says what kind of conversation a chat notification is from, and its name and photo', () => {
      const result = withConversations(
        [
          { id: 'n1', conversationId: 'c-group' },
          { id: 'n2', conversationId: 'c-dm' },
          { id: 'n3', conversationId: null },
          { id: 'n4', conversationId: 'c-gone' },
        ],
        new Map([
          [
            'c-group',
            {
              id: 'c-group',
              type: 'GROUP',
              title: 'Squad',
              photoUrl: 'https://cdn.example.com/squad.png',
            },
          ],
          ['c-dm', { id: 'c-dm', type: 'DIRECT', title: null, photoUrl: null }],
        ]),
      );

      expect(result.map((item) => item.conversation)).toEqual([
        {
          type: 'GROUP',
          title: 'Squad',
          photoUrl: 'https://cdn.example.com/squad.png',
        },
        { type: 'DIRECT', title: null, photoUrl: null },
        null,
        null,
      ]);
    });
  });
});
